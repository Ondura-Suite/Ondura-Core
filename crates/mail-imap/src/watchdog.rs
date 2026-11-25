//! Stall detection for IMAP connections.
//!
//! A fixed timeout around a whole operation either cuts off large but healthy
//! transfers (many new messages, big attachments) or waits far too long for a
//! connection that silently died (NAT timeout, server restart). [`Watchdog`]
//! instead fails a read or write only when it makes no progress at all for
//! the configured time.

use std::io;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::task::{Context, Poll};
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::time::Sleep;

/// Shared stall limit of one connection; `0` disables the check (used while
/// the connection deliberately waits in IDLE).
#[derive(Clone, Debug)]
pub struct StallLimit(Arc<AtomicU64>);

impl StallLimit {
    pub fn new(limit: Duration) -> Self {
        Self(Arc::new(AtomicU64::new(limit.as_millis() as u64)))
    }

    pub fn set(&self, limit: Option<Duration>) {
        self.0.store(limit.map_or(0, |d| d.as_millis().max(1) as u64), Ordering::Relaxed);
    }

    fn get(&self) -> Option<Duration> {
        match self.0.load(Ordering::Relaxed) {
            0 => None,
            ms => Some(Duration::from_millis(ms)),
        }
    }
}

/// Wraps a stream and turns a read or write that stays pending for longer
/// than the stall limit into an `io::ErrorKind::TimedOut` error.
#[derive(Debug)]
pub struct Watchdog<S> {
    inner: S,
    limit: StallLimit,
    read_timer: Option<Pin<Box<Sleep>>>,
    write_timer: Option<Pin<Box<Sleep>>>,
}

impl<S> Watchdog<S> {
    pub fn new(inner: S, limit: StallLimit) -> Self {
        Self { inner, limit, read_timer: None, write_timer: None }
    }
}

/// Track a pending poll: arm the timer on the first `Pending`, disarm it on
/// progress, and report a stall once it fires.
fn watch<T>(timer: &mut Option<Pin<Box<Sleep>>>, limit: Option<Duration>, cx: &mut Context<'_>, poll: Poll<io::Result<T>>) -> Poll<io::Result<T>> {
    if poll.is_ready() {
        *timer = None;
        return poll;
    }
    let Some(limit) = limit else {
        *timer = None;
        return Poll::Pending;
    };
    let sleep = timer.get_or_insert_with(|| Box::pin(tokio::time::sleep(limit)));
    if sleep.as_mut().poll(cx).is_ready() {
        *timer = None;
        return Poll::Ready(Err(io::Error::new(io::ErrorKind::TimedOut, "the server stopped responding")));
    }
    Poll::Pending
}

impl<S: AsyncRead + Unpin> AsyncRead for Watchdog<S> {
    fn poll_read(self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &mut ReadBuf<'_>) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        let poll = Pin::new(&mut this.inner).poll_read(cx, buf);
        watch(&mut this.read_timer, this.limit.get(), cx, poll)
    }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for Watchdog<S> {
    fn poll_write(self: Pin<&mut Self>, cx: &mut Context<'_>, data: &[u8]) -> Poll<io::Result<usize>> {
        let this = self.get_mut();
        let poll = Pin::new(&mut this.inner).poll_write(cx, data);
        watch(&mut this.write_timer, this.limit.get(), cx, poll)
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        let poll = Pin::new(&mut this.inner).poll_flush(cx);
        watch(&mut this.write_timer, this.limit.get(), cx, poll)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().inner).poll_shutdown(cx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[tokio::test(start_paused = true)]
    async fn fails_a_stalled_read() {
        let (client, _server) = tokio::io::duplex(64);
        let mut stream = Watchdog::new(client, StallLimit::new(Duration::from_secs(30)));
        let mut buf = [0u8; 8];
        let err = stream.read(&mut buf).await.unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::TimedOut);
    }

    #[tokio::test(start_paused = true)]
    async fn slow_but_steady_transfers_pass() {
        let (client, mut server) = tokio::io::duplex(64);
        let mut stream = Watchdog::new(client, StallLimit::new(Duration::from_secs(30)));
        tokio::spawn(async move {
            // 10 chunks, 20 s apart: far longer than the limit in total.
            for _ in 0..10 {
                tokio::time::sleep(Duration::from_secs(20)).await;
                server.write_all(b"data").await.unwrap();
            }
        });
        let mut buf = [0u8; 40];
        stream.read_exact(&mut buf).await.unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn disabled_limit_waits() {
        let (client, mut server) = tokio::io::duplex(64);
        let limit = StallLimit::new(Duration::from_secs(30));
        let mut stream = Watchdog::new(client, limit.clone());
        limit.set(None);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(600)).await;
            server.write_all(b"ok").await.unwrap();
        });
        let mut buf = [0u8; 2];
        stream.read_exact(&mut buf).await.unwrap();
    }
}

//! Office Open XML documents for the Nexora apps.
//!
//! Each format is converted into a compact, JSON-serialisable model that
//! the editors work on, and written back as a standards-conforming
//! package that Microsoft Office and LibreOffice open:
//!
//! * [`docx`] – Nexora Text
//! * [`xlsx`] – Nexora Tabellen
//! * [`pptx`] – Nexora Präsentation
//!
//! The OpenDocument formats map onto the same models: [`odt`], [`ods`]
//! and [`odp`].
//!
//! Features without an equivalent in the model are dropped on import and
//! reported as warnings, so the user knows what will not survive a save.

pub mod chart;
mod chartex;
pub mod docx;
pub mod odf;
pub mod odp;
pub mod ods;
pub mod odt;
pub mod package;
pub mod pptx;
pub mod xlsx;
mod structured;
mod xlfn;
pub mod xml;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Format(String),
    #[error("XML-Fehler: {0}")]
    Xml(String),
    #[error("E/A-Fehler: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

/// Length conversions used by all formats.
pub mod units {
    /// Twentieths of a point (WordprocessingML) to millimetres.
    pub fn twips_to_mm(t: f64) -> f64 {
        t / 1440.0 * 25.4
    }
    pub fn mm_to_twips(mm: f64) -> i64 {
        (mm / 25.4 * 1440.0).round() as i64
    }
    /// English Metric Units (DrawingML) to CSS pixels at 96 dpi.
    pub fn emu_to_px(e: f64) -> f64 {
        e / 9525.0
    }
    pub fn px_to_emu(px: f64) -> i64 {
        (px * 9525.0).round() as i64
    }
}

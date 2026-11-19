//! Language services of Ondura Text: grammar checking (LanguageTool),
//! translation (LibreTranslate or DeepL), reading aloud through the
//! system's speech synthesis, and starting the system's dictation.

use std::process::Child;
use std::sync::Mutex;

use serde_json::Value;

use crate::update::client;

type CmdResult<T> = Result<T, String>;

fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn http() -> reqwest::Client {
    client(Some(std::time::Duration::from_secs(30)))
}

/// Check text with a LanguageTool server (`https://api.languagetool.org`
/// or an own one). Returns the server's `matches`.
#[tauri::command]
pub async fn grammar_check(server: String, text: String, language: String) -> CmdResult<Value> {
    let base = server.trim().trim_end_matches('/');
    if !base.starts_with("https://") && !base.starts_with("http://") {
        return Err(ondura_i18n::tr!("Ungültige Serveradresse"));
    }
    let url = if base.ends_with("/v2") { format!("{base}/check") } else { format!("{base}/v2/check") };
    let body = format!("text={}&language={}&enabledOnly=false", encode(&text), encode(&language));
    let resp = http()
        .post(url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(ondura_i18n::tr!("LanguageTool antwortet mit {0}", resp.status()));
    }
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(v["matches"].clone())
}

/// Translate text. `service` is `libretranslate` (with server URL and
/// optional API key) or `deepl` (API key; free keys end in `:fx`).
#[tauri::command]
pub async fn translate_text(service: String, server: String, key: String, text: String, source: String, target: String) -> CmdResult<String> {
    let http = http();
    match service.as_str() {
        "deepl" => {
            let host = if key.trim().ends_with(":fx") { "https://api-free.deepl.com" } else { "https://api.deepl.com" };
            let mut body = serde_json::json!({ "text": [text], "target_lang": target.to_uppercase() });
            if !source.is_empty() && source != "auto" {
                body["source_lang"] = source.to_uppercase().into();
            }
            let resp = http
                .post(format!("{host}/v2/translate"))
                .header("Authorization", format!("DeepL-Auth-Key {}", key.trim()))
                .json(&body)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            if !resp.status().is_success() {
                return Err(ondura_i18n::tr!("DeepL antwortet mit {0}", resp.status()));
            }
            let v: Value = resp.json().await.map_err(|e| e.to_string())?;
            Ok(v["translations"][0]["text"].as_str().unwrap_or_default().to_string())
        }
        _ => {
            let base = server.trim().trim_end_matches('/');
            if !base.starts_with("https://") && !base.starts_with("http://") {
                return Err(ondura_i18n::tr!("Ungültige Serveradresse"));
            }
            let mut body = serde_json::json!({ "q": text, "source": if source.is_empty() { "auto" } else { &source }, "target": target, "format": "text" });
            if !key.trim().is_empty() {
                body["api_key"] = key.trim().into();
            }
            let resp = http.post(format!("{base}/translate")).json(&body).send().await.map_err(|e| e.to_string())?;
            let status = resp.status();
            let v: Value = resp.json().await.map_err(|e| e.to_string())?;
            if !status.is_success() {
                return Err(v["error"].as_str().map(str::to_string).unwrap_or_else(|| ondura_i18n::tr!("LibreTranslate antwortet mit {0}", status)));
            }
            Ok(v["translatedText"].as_str().unwrap_or_default().to_string())
        }
    }
}

/// Speech process started by `speak` (stopped by `speak_stop`).
static SPEAKER: Mutex<Option<Child>> = Mutex::new(None);

/// Read text aloud with the system's speech synthesis (used where the web
/// view has no voices). Returns once speaking has started.
#[tauri::command]
pub fn speak(text: String, lang: String) -> CmdResult<()> {
    speak_stop();
    let child = spawn_speech(&text, &lang).map_err(|e| ondura_i18n::tr!("Keine Sprachausgabe verfügbar: {0}", e))?;
    *SPEAKER.lock().unwrap() = Some(child);
    Ok(())
}

/// `true` while the system speech process is running.
#[tauri::command]
pub fn speaking() -> bool {
    let mut g = SPEAKER.lock().unwrap();
    match g.as_mut().map(|c| c.try_wait()) {
        Some(Ok(None)) => true,
        _ => {
            *g = None;
            false
        }
    }
}

#[tauri::command]
pub fn speak_stop() {
    if let Some(mut c) = SPEAKER.lock().unwrap().take() {
        let _ = c.kill();
        let _ = c.wait();
    }
}

#[cfg(windows)]
fn spawn_speech(text: &str, lang: &str) -> std::io::Result<Child> {
    use std::io::Write;
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    // System.Speech reads the text from stdin (no quoting problems).
    let script = format!(
        "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; \
         $v = $s.GetInstalledVoices() | Where-Object {{ $_.VoiceInfo.Culture.Name -like '{}*' }} | Select-Object -First 1; \
         if ($v) {{ $s.SelectVoice($v.VoiceInfo.Name) }}; $s.Speak([Console]::In.ReadToEnd())",
        lang.chars().filter(|c| c.is_ascii_alphabetic() || *c == '-').collect::<String>()
    );
    let mut child = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .stdin(Stdio::piped())
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .spawn()?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(text.as_bytes())?;
    }
    Ok(child)
}

#[cfg(target_os = "macos")]
fn spawn_speech(text: &str, _lang: &str) -> std::io::Result<Child> {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let mut child = Command::new("say").args(["-f", "-"]).stdin(Stdio::piped()).spawn()?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(text.as_bytes())?;
    }
    Ok(child)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn spawn_speech(text: &str, lang: &str) -> std::io::Result<Child> {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let lang: String = lang.chars().filter(|c| c.is_ascii_alphabetic()).take(2).collect();
    // speech-dispatcher, else espeak-ng / espeak.
    if let Ok(c) = Command::new("spd-say").args(["-w", "-l", &lang, "-e"]).stdin(Stdio::piped()).spawn() {
        let mut c = c;
        if let Some(mut stdin) = c.stdin.take() {
            stdin.write_all(text.as_bytes())?;
        }
        return Ok(c);
    }
    for bin in ["espeak-ng", "espeak"] {
        if let Ok(mut c) = Command::new(bin).args(["-v", &lang, "--stdin"]).stdin(Stdio::piped()).spawn() {
            if let Some(mut stdin) = c.stdin.take() {
                stdin.write_all(text.as_bytes())?;
            }
            return Ok(c);
        }
    }
    Err(std::io::Error::new(std::io::ErrorKind::NotFound, "spd-say / espeak-ng"))
}

/// Start the system's dictation into the focused field (Windows: Win+H).
/// Returns `false` where the system has no shortcut for it.
#[tauri::command]
pub fn start_dictation() -> bool {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, SendInput, VK_LWIN};
        let key = |vk: u16, up: bool| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: vk, wScan: 0, dwFlags: if up { KEYEVENTF_KEYUP } else { 0 }, time: 0, dwExtraInfo: 0 } },
        };
        let h = b'H' as u16;
        let inputs = [key(VK_LWIN, false), key(h, false), key(h, true), key(VK_LWIN, true)];
        // SAFETY: a valid array of INPUT structures with its length and size.
        let sent = unsafe { SendInput(inputs.len() as u32, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32) };
        return sent == inputs.len() as u32;
    }
    #[allow(unreachable_code)]
    false
}

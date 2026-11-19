//! Weather forecast for the calendar (Open-Meteo, no API key needed).

use serde::Serialize;
use serde_json::Value;

use crate::update::client;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayWeather {
    pub date: String,
    /// WMO weather code.
    pub code: u32,
    pub max: f64,
    pub min: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Forecast {
    pub place: String,
    pub days: Vec<DayWeather>,
}

fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Seven-day forecast for a place name (city, optionally with country).
#[tauri::command]
pub async fn weather_forecast(place: String, lang: Option<String>) -> Result<Forecast, String> {
    let http = client(Some(std::time::Duration::from_secs(15)));
    let lang = lang.unwrap_or_else(|| "de".into());
    let geo: Value = http
        .get(format!("https://geocoding-api.open-meteo.com/v1/search?name={}&count=1&language={}", encode(place.trim()), encode(&lang)))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let hit = &geo["results"][0];
    let (Some(lat), Some(lon)) = (hit["latitude"].as_f64(), hit["longitude"].as_f64()) else {
        return Err(ondura_i18n::tr!("Ort „{0}“ wurde nicht gefunden", place.trim()));
    };
    let name = [hit["name"].as_str(), hit["country"].as_str()].into_iter().flatten().collect::<Vec<_>>().join(", ");
    let v: Value = http
        .get(format!(
            "https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=7"
        ))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let d = &v["daily"];
    let days = d["time"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
        .filter_map(|(i, t)| {
            Some(DayWeather {
                date: t.as_str()?.to_string(),
                code: d["weather_code"][i].as_u64().unwrap_or(0) as u32,
                max: d["temperature_2m_max"][i].as_f64()?,
                min: d["temperature_2m_min"][i].as_f64()?,
            })
        })
        .collect();
    Ok(Forecast { place: name, days })
}

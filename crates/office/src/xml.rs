//! Minimal namespace-aware XML DOM for Office Open XML parts.
//!
//! Element names are normalised to canonical prefixes (`w:p`, `a:t`, …)
//! based on the namespace URI, so documents that use unusual prefixes
//! parse the same way.

use quick_xml::events::Event;
use quick_xml::name::ResolveResult;
use quick_xml::reader::NsReader;

use crate::{Error, Result};

/// Canonical prefix for well-known OOXML namespaces.
fn canonical(ns: &[u8]) -> Option<&'static str> {
    Some(match ns {
        b"http://schemas.openxmlformats.org/wordprocessingml/2006/main" | b"http://purl.oclc.org/ooxml/wordprocessingml/main" => "w",
        b"http://schemas.openxmlformats.org/officeDocument/2006/relationships" | b"http://purl.oclc.org/ooxml/officeDocument/relationships" => "r",
        b"http://schemas.openxmlformats.org/drawingml/2006/main" | b"http://purl.oclc.org/ooxml/drawingml/main" => "a",
        b"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" => "wp",
        b"http://schemas.openxmlformats.org/drawingml/2006/picture" => "pic",
        b"http://schemas.openxmlformats.org/presentationml/2006/main" | b"http://purl.oclc.org/ooxml/presentationml/main" => "p",
        b"http://schemas.openxmlformats.org/spreadsheetml/2006/main" | b"http://purl.oclc.org/ooxml/spreadsheetml/main" => "x",
        b"http://schemas.openxmlformats.org/package/2006/relationships" => "rel",
        b"http://schemas.openxmlformats.org/package/2006/content-types" => "ct",
        b"http://schemas.openxmlformats.org/markup-compatibility/2006" => "mc",
        b"http://schemas.openxmlformats.org/package/2006/metadata/core-properties" => "cp",
        b"http://purl.org/dc/elements/1.1/" => "dc",
        b"http://schemas.microsoft.com/office/word/2010/wordprocessingShape" => "wps",
        b"urn:schemas-microsoft-com:vml" => "v",
        _ => return None,
    })
}

#[derive(Debug, Clone, Default)]
pub struct Element {
    /// Canonical qualified name, e.g. `w:p`; unknown namespaces keep the local name.
    pub name: String,
    pub attrs: Vec<(String, String)>,
    pub children: Vec<Node>,
}

#[derive(Debug, Clone)]
pub enum Node {
    Element(Element),
    Text(String),
}

impl Element {
    pub fn attr(&self, name: &str) -> Option<&str> {
        self.attrs.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }

    pub fn elements(&self) -> impl Iterator<Item = &Element> {
        self.children.iter().filter_map(|c| match c {
            Node::Element(e) => Some(e),
            Node::Text(_) => None,
        })
    }

    pub fn child(&self, name: &str) -> Option<&Element> {
        self.elements().find(|e| e.name == name)
    }

    pub fn children_named<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a Element> + 'a {
        self.elements().filter(move |e| e.name == name)
    }

    /// First descendant (depth first) with the given name.
    pub fn find(&self, name: &str) -> Option<&Element> {
        for e in self.elements() {
            if e.name == name {
                return Some(e);
            }
            if let Some(f) = e.find(name) {
                return Some(f);
            }
        }
        None
    }

    pub fn find_all<'a>(&'a self, name: &str, out: &mut Vec<&'a Element>) {
        for e in self.elements() {
            if e.name == name {
                out.push(e);
            }
            e.find_all(name, out);
        }
    }

    /// Concatenated text content.
    pub fn text(&self) -> String {
        let mut s = String::new();
        self.collect_text(&mut s);
        s
    }

    fn collect_text(&self, s: &mut String) {
        for c in &self.children {
            match c {
                Node::Text(t) => s.push_str(t),
                Node::Element(e) => e.collect_text(s),
            }
        }
    }

    /// `w:val` style attribute of a child element (`<w:jc w:val="center"/>`).
    pub fn child_val(&self, child: &str) -> Option<&str> {
        self.child(child).and_then(|c| c.attr("w:val").or_else(|| c.attr("val")))
    }
}

pub fn parse(bytes: &[u8]) -> Result<Element> {
    let mut reader = NsReader::from_reader(bytes);
    reader.config_mut().trim_text(false);
    let mut stack: Vec<Element> = vec![Element { name: "#document".into(), ..Default::default() }];
    let mut buf = Vec::new();
    loop {
        let (ns, event) = reader.read_resolved_event_into(&mut buf).map_err(|e| Error::Xml(e.to_string()))?;
        let empty = matches!(event, Event::Empty(_));
        match (ns, event) {
            (ns, Event::Start(start)) | (ns, Event::Empty(start)) => {
                let local = String::from_utf8_lossy(start.local_name().as_ref()).into_owned();
                let name = match ns {
                    ResolveResult::Bound(n) => canonical(n.as_ref()).map(|p| format!("{p}:{local}")).unwrap_or(local),
                    _ => local,
                };
                let mut attrs = Vec::new();
                for a in start.attributes().flatten() {
                    let (rns, lname) = reader.resolve_attribute(a.key);
                    let lname = String::from_utf8_lossy(lname.as_ref()).into_owned();
                    let key = match rns {
                        ResolveResult::Bound(n) => match canonical(n.as_ref()) {
                            Some(p) => format!("{p}:{lname}"),
                            None if n.as_ref() == b"http://www.w3.org/XML/1998/namespace" => format!("xml:{lname}"),
                            None => lname,
                        },
                        _ => {
                            if a.key.as_ref().starts_with(b"xmlns") {
                                continue;
                            }
                            lname
                        }
                    };
                    let value = a.unescape_value().map(|v| v.into_owned()).unwrap_or_default();
                    attrs.push((key, value));
                }
                let el = Element { name, attrs, children: Vec::new() };
                if empty {
                    stack.last_mut().unwrap().children.push(Node::Element(el));
                } else {
                    stack.push(el);
                }
            }
            (_, Event::End(_)) => {
                let el = stack.pop().ok_or_else(|| Error::Xml("unbalanced XML".into()))?;
                stack.last_mut().ok_or_else(|| Error::Xml("unbalanced XML".into()))?.children.push(Node::Element(el));
            }
            (_, Event::Text(t)) => {
                let t = t.decode().map_err(|e| Error::Xml(e.to_string()))?;
                let t = quick_xml::escape::unescape(&t).map(|c| c.into_owned()).unwrap_or_else(|_| t.into_owned());
                stack.last_mut().unwrap().children.push(Node::Text(t));
            }
            (_, Event::GeneralRef(r)) => {
                let name = r.decode().map_err(|e| Error::Xml(e.to_string()))?;
                let text = match name.as_ref() {
                    "amp" => "&".to_string(),
                    "lt" => "<".to_string(),
                    "gt" => ">".to_string(),
                    "quot" => "\"".to_string(),
                    "apos" => "'".to_string(),
                    n if n.starts_with("#x") => u32::from_str_radix(&n[2..], 16).ok().and_then(char::from_u32).map(String::from).unwrap_or_default(),
                    n if n.starts_with('#') => n[1..].parse().ok().and_then(char::from_u32).map(String::from).unwrap_or_default(),
                    _ => String::new(),
                };
                stack.last_mut().unwrap().children.push(Node::Text(text));
            }
            (_, Event::CData(t)) => {
                stack.last_mut().unwrap().children.push(Node::Text(String::from_utf8_lossy(&t).into_owned()));
            }
            (_, Event::Eof) => break,
            _ => {}
        }
        buf.clear();
    }
    let doc = stack.pop().ok_or_else(|| Error::Xml("empty document".into()))?;
    doc.children
        .into_iter()
        .find_map(|c| match c {
            Node::Element(e) => Some(e),
            Node::Text(_) => None,
        })
        .ok_or_else(|| Error::Xml("no root element".into()))
}

/// Escape text for element content and attribute values.
pub fn esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => o.push_str("&amp;"),
            '<' => o.push_str("&lt;"),
            '>' => o.push_str("&gt;"),
            '"' => o.push_str("&quot;"),
            // Characters not allowed in XML 1.0.
            c if (c as u32) < 0x20 && !matches!(c, '\t' | '\n' | '\r') => {}
            c => o.push(c),
        }
    }
    o
}

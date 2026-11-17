//! A tiny XML tree for reading EWS responses. Element names are stored
//! without namespace prefixes; EWS uses unique local names, so that is enough.

use quick_xml::Reader;
use quick_xml::events::Event;

#[derive(Debug, Default, Clone)]
pub struct Node {
    pub name: String,
    pub attrs: Vec<(String, String)>,
    pub text: String,
    pub children: Vec<Node>,
}

fn local(name: &[u8]) -> String {
    let s = String::from_utf8_lossy(name);
    match s.rsplit_once(':') {
        Some((_, l)) => l.to_string(),
        None => s.into_owned(),
    }
}

impl Node {
    pub fn parse(xml: &str) -> Result<Node, String> {
        let mut reader = Reader::from_str(xml);

        let mut stack: Vec<Node> = vec![Node { name: "#document".into(), ..Default::default() }];
        loop {
            match reader.read_event().map_err(|e| e.to_string())? {
                Event::Start(e) => {
                    let mut n = Node { name: local(e.name().as_ref()), ..Default::default() };
                    for a in e.attributes().flatten() {
                        let v = a.unescape_value().map(|v| v.into_owned()).unwrap_or_default();
                        n.attrs.push((local(a.key.as_ref()), v));
                    }
                    stack.push(n);
                }
                Event::Empty(e) => {
                    let mut n = Node { name: local(e.name().as_ref()), ..Default::default() };
                    for a in e.attributes().flatten() {
                        let v = a.unescape_value().map(|v| v.into_owned()).unwrap_or_default();
                        n.attrs.push((local(a.key.as_ref()), v));
                    }
                    stack.last_mut().expect("root").children.push(n);
                }
                Event::Text(t) => {
                    let text = t.decode().map_err(|e| e.to_string())?;
                    stack.last_mut().expect("root").text.push_str(&text);
                }
                Event::GeneralRef(r) => {
                    let resolved = match r.resolve_char_ref().map_err(|e| e.to_string())? {
                        Some(c) => c.to_string(),
                        None => match r.decode().map_err(|e| e.to_string())?.as_ref() {
                            "amp" => "&".into(),
                            "lt" => "<".into(),
                            "gt" => ">".into(),
                            "quot" => "\"".into(),
                            "apos" => "'".into(),
                            other => format!("&{other};"),
                        },
                    };
                    stack.last_mut().expect("root").text.push_str(&resolved);
                }
                Event::CData(t) => {
                    stack.last_mut().expect("root").text.push_str(&String::from_utf8_lossy(&t));
                }
                Event::End(_) => {
                    let mut n = stack.pop().expect("balanced");
                    n.text = n.text.trim().to_string();
                    match stack.last_mut() {
                        Some(parent) => parent.children.push(n),
                        None => return Err("unbalanced XML".into()),
                    }
                }
                Event::Eof => break,
                _ => {}
            }
        }
        if stack.len() != 1 {
            return Err("unexpected end of XML".into());
        }
        Ok(stack.pop().expect("root"))
    }

    pub fn attr(&self, name: &str) -> Option<&str> {
        self.attrs.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }

    pub fn child(&self, name: &str) -> Option<&Node> {
        self.children.iter().find(|c| c.name == name)
    }

    pub fn children_named<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a Node> + 'a {
        self.children.iter().filter(move |c| c.name == name)
    }

    /// Text of a direct child element.
    pub fn text_of(&self, name: &str) -> Option<&str> {
        self.child(name).map(|c| c.text.as_str())
    }

    /// First descendant with the given name (depth-first).
    pub fn find(&self, name: &str) -> Option<&Node> {
        for c in &self.children {
            if c.name == name {
                return Some(c);
            }
            if let Some(n) = c.find(name) {
                return Some(n);
            }
        }
        None
    }

    /// All descendants with the given name.
    pub fn find_all<'a>(&'a self, name: &str, out: &mut Vec<&'a Node>) {
        for c in &self.children {
            if c.name == name {
                out.push(c);
            } else {
                c.find_all(name, out);
            }
        }
    }
}

pub fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_namespaced_soap() {
        let xml = r#"<?xml version="1.0"?><s:Envelope xmlns:s="x"><s:Body><m:Resp ResponseClass="Success">
            <t:Subject>Gr&#252;&#223;e &amp; mehr</t:Subject><t:ItemId Id="AAA" ChangeKey="B"/></m:Resp></s:Body></s:Envelope>"#;
        let doc = Node::parse(xml).unwrap();
        let resp = doc.find("Resp").unwrap();
        assert_eq!(resp.attr("ResponseClass"), Some("Success"));
        assert_eq!(resp.text_of("Subject"), Some("Grüße & mehr"));
        assert_eq!(resp.child("ItemId").unwrap().attr("Id"), Some("AAA"));
    }
}

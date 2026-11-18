//! Calendars, contacts and tasks for the suite.
//!
//! Like mail, everything is mirrored into a local SQLite store
//! ([`PimStore`]). Adapters implement [`PimProvider`]: Microsoft Graph and
//! EWS speak their own protocols; CalDAV/CardDAV and the built-in local
//! store share the iCalendar/vCard code in [`resource`].

pub mod engine;
pub mod ical;
pub mod model;
pub mod provider;
pub mod resource;
pub mod store;
pub mod vcard;

pub use engine::{PimEngine, PimEvent};
pub use model::*;
pub use provider::{Changes, EventResource, Known, PimProvider, RemoteCollection, Room, Window};
pub use store::PimStore;

# Event Tagging panel

Tag events at the current playback time, visualize them as ticks on the playback
timeline, and export them for downstream systems (databases, annotation
pipelines, …).

Each event has:

- a **timestamp** (the playback time at which it was tagged),
- an optional **before** / **after** duration in seconds, turning the event into
  a time range around the timestamp,
- a set of **attributes** — each attribute is a pick-one-from-a-list selection
  (e.g. weather, road type) defined by a configurable schema.

Events are stored in the panel configuration, so they persist with the layout.

## Attribute configuration file

Use the **Attribute config** button to load the attribute schema from a JSON
file:

```json
{
  "attributes": [
    { "key": "weather", "label": "Weather", "options": ["sunny", "cloudy", "rain", "snow", "fog"] },
    { "key": "roadType", "label": "Road type", "options": ["highway", "urban", "rural", "parking"] }
  ]
}
```

A bare array of definitions is also accepted. Every attribute must declare a
unique `key` and a non-empty `options` list; `label` is optional.

### Multi-level (cascading) dropdowns

An option can be an object instead of a plain string. The object form adds a
`label` (shown in the dropdown) and `children` — additional attribute
definitions that appear only while that option is selected. Children nest
arbitrarily deep, so selecting one dropdown can reveal more:

```json
{
  "attributes": [
    {
      "key": "weather",
      "label": "Weather",
      "options": [
        "sunny",
        {
          "value": "rain",
          "label": "Rain",
          "children": [
            { "key": "rainIntensity", "label": "Rain intensity", "options": ["light", "moderate", "heavy"] }
          ]
        }
      ]
    }
  ]
}
```

Here, picking **rain** reveals a **Rain intensity** dropdown; picking any other
weather hides it again (and clears any value that was chosen). Attribute `key`s
must be unique across every level, since all selected values are stored in a
single flat `attributes` map per event (e.g. `{ "weather": "rain",
"rainIntensity": "heavy" }`).

### Grouping attributes

Add an optional `group` to an attribute to show it under a heading. Attributes
that share a group render together beneath a single header (in the order they
first appear); attributes without a group render without one. This is handy for
bucketing labels by category, e.g. "ODD relevant" vs "Feature based":

```json
{
  "attributes": [
    { "key": "weather", "label": "Weather", "group": "ODD relevant", "options": ["sunny", "rain"] },
    { "key": "roadType", "label": "Road type", "group": "ODD relevant", "options": ["urban", "highway"] },
    { "key": "feature", "label": "Feature under test", "group": "Feature based", "options": ["ACC", "AEB", "LKA"] }
  ]
}
```

Child dropdowns revealed by a cascading option inherit their parent's group
unless they declare their own `group`.

## Importing and exporting events

**Export** downloads the tagged events as JSON:

```json
{
  "version": 1,
  "exportedAt": "2026-06-11T12:00:00.000Z",
  "events": [
    {
      "id": "5cc69a8a-…",
      "timestamp": { "sec": 1700000000, "nsec": 500000000 },
      "timestampSec": 1700000000.5,
      "beforeSec": 1,
      "afterSec": 2,
      "attributes": { "weather": "rain", "roadType": "highway" },
      "createdAt": "2026-06-11T11:58:00.000Z"
    }
  ]
}
```

**Import** accepts the same format (round-trip safe), a bare array of events,
or events with timestamps given as seconds (number) or RFC-3339 strings:

```json
[
  { "timestamp": 1700000000.5, "beforeSec": 1, "afterSec": 2, "attributes": { "weather": "rain" } }
]
```

## Entry point for external services

While an Event Tagging panel is open, external services can push events into it:

```js
// From any window context (e.g. an embedding page, iframe, or automation):
window.postMessage({
  type: "lichtblick.eventTagging.addEvents",
  events: [{ timestamp: 1700000000.5, attributes: { weather: "rain" } }],
});

// Or directly via the global API:
window.lichtblickEventTagging.addEvents([{ timestamp: 1700000000.5 }]);

// Read the currently tagged events programmatically (e.g. to push to a database):
const events = window.lichtblickEventTagging.getEvents();
```

Incoming events are validated with the same rules as file imports; invalid
payloads are rejected with a descriptive error.

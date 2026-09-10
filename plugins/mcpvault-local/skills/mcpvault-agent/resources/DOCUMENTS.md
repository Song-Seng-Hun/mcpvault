# Document/resource reads

Discover `documents.search` once only if unnamed; execute dynamic endpoints via
`call_endpoint` using discovered schemas. Follow revision-pinned `documents.read`
actions rather than inventing paths, IDs or arguments.

Prefer one semantic fragment with headings/qualifiers. Use exact lines for a
known one-line target; expand previous tail, next head or parent only for a
missing dependency. `documents.outline` is optional orientation, not a mandatory
pre-read. Batch at most eight needed ranges. Follow bounded continuations only
when omitted content matters; a stale revision requires a fresh source action.

Keep returned source ranges and explicit gaps. PDF offsets/lines describe
extracted text: cite the original page/bbox, never physical PDF line numbers.
Descriptions/similarity are navigation, not evidence. Caller-provided reading
receipts suppress proven repeats only within the authenticated session;
`forceRead` rereads explicitly. The server cannot erase conversation history.

`resources.manifest` and `resources.export` preserve original bytes, bundle
paths, scripts and licenses. They never execute scripts. Reassemble export
continuations and verify the source hash. Missing PDF/OCR support is explicitly
unavailable, not permission to send documents to an external service.

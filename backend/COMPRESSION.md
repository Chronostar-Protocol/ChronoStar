# Compression delivery policy

HTTP compression should be negotiated only for JSON or text responses that are
large enough to benefit from it. Keep `Vary: Accept-Encoding` on compressed
responses and preserve a valid identity response when a client requests it.

Do not apply response compression to `/api/stream` or any
`text/event-stream` response: buffering an SSE stream delays heartbeats and
event delivery. Reverse proxies must follow the same exclusion and avoid adding
a second compression layer to an already encoded response.

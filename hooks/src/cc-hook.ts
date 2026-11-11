// Called by Claude Code hooks. Must be a no-op outside cc-cockpit sessions.
const sessionId = process.env.CCC_SESSION_ID;
if (!sessionId) process.exit(0);

// Marco 4: read hook JSON from stdin and POST it to the local hook endpoint.
process.exit(0);

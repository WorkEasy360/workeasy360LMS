package com.workeasy360.backend.web;

import java.time.Instant;

/** Consistent error shape for every failure response, so the frontend's api.js can render a useful
 *  "Unable to save course [Retry]" style state instead of failing silently. */
public record ApiError(int status, String error, String message, String path, Instant timestamp) {}

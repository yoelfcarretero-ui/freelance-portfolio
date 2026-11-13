import { createHealthHandler } from "../lib/handlers.js";

/** GET /api/health - which mode is active and why (never returns secrets). */
export default createHealthHandler();

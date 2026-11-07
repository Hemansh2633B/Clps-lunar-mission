/**
 * Application vs. report-schema versioning (v1.10).
 *
 * APP_VERSION tracks the product release (package.json — single source of truth).
 * REPORT_SCHEMA_VERSION tracks the JSON mission-report FORMAT and changes ONLY
 * when that format changes. They are deliberately independent: an application
 * release that does not alter the report format must NOT bump the schema version,
 * and a schema change is called out explicitly in docs/scientific-method.md.
 *
 * Schema history:
 *  - '1.7.0-product' (≤ v1.9): legacy label that conflated product and format.
 *  - '2.0.0' (v1.10): independent schema; adds applicationVersion, fingerprint,
 *    effective/requested config split, status-aware terrain disclosure, energy
 *    history, and provenance columns on every CSV.
 */
import pkg from '../package.json';

export const APP_VERSION: string = pkg.version;
export const REPORT_SCHEMA_VERSION = '2.0.0';
export const REPORT_SCHEMA_POLICY =
  'reportSchemaVersion identifies the report FORMAT and is independent of applicationVersion; it changes only when the exported format changes.';

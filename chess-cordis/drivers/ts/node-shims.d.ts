// Minimal ambient shims so tsc type-checks the harness driver without @types/node.
// These globals are only used by driver.ts and exist at runtime under Node.
declare const process: any;
declare const require: any;

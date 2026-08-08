// Stands in for the `server-only` package under Vitest, which does not run
// modules under Next's react-server condition. Importing the real package
// outside that condition throws by design.
export {};

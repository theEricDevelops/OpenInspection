declare module '*.css' {
    const content: string;
    export default content;
}

// Cloudflare Worker types (replaced by portable implementations)
// We keep these as unknown for compatibility where needed
declare global {
    const ExecutionContext: unknown; // Fallback if needed
    const ScheduledEvent: unknown; // Fallback if needed
    const D1Result: unknown; // Fallback if needed
    const D1Meta: unknown; // Fallback if needed
    const D1PreparedStatement: unknown; // Fallback if needed
    const D1ExecResult: unknown; // Fallback if needed
}


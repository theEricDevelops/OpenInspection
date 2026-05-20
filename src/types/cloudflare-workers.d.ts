/**
 * Stub for the Cloudflare Workers Workflow module.
 * This allows the project to compile after removing Cloudflare dependencies.
 * The actual implementation will be replaced in Phase 3 (BullMQ or simple promises).
 */

declare module 'cloudflare:workers' {
    export class WorkflowEntrypoint<Env = any, Params = any> {
        constructor(ctx?: any, env?: any);
        env: any;
        ctx: any;
    }

    export class WorkflowStep {
        do<T>(name: string, callback: () => Promise<T>): Promise<T>;
    }

    export type WorkflowEvent<Params = any> = {
        payload: Params;
        timestamp: Date;
        instanceId?: string;
    };
}

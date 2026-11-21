export declare const VERSION = "0.3.1";
export type Property = string | number | boolean | null | Date | Property[] | {
    [key: string]: Property;
};
export type Properties = Record<string, Property>;
export interface InitOptions {
    /** Ingestion origin or first-party proxy path. Default https://in.datacub.to */
    apiHost?: string;
    /** Treat `#/route` fragments as routes. Default false. */
    hashRouting?: boolean;
    /** Clicks and form submits. Default true. Pageviews and page leaves are always on. */
    autocapture?: boolean;
    /** Rage clicks: 3 quick clicks in a row (the browser's own click count). Default true; needs autocapture. */
    rageClicks?: boolean;
    /** Your app version or deployment ID, sent as context.release. */
    release?: string;
    /**
     * Store and send nothing until datacub.consent.grant(). Default false: tracking starts at once.
     * Turn it on with "Ask for consent first" in the project's settings, which makes datacub refuse events
     * sent without a grant.
     */
    requireConsent?: boolean;
    /**
     * The insights module (Web Vitals, long tasks, resource totals, form field details, device
     * model), loaded after tracking starts from apiHost. Default true.
     */
    insights?: boolean;
    /** Turn kinds of capture off on this site. The project's settings in datacub can turn them off too. */
    capture?: Capture;
}
export interface Capture {
    /** Text of clicked buttons and links. */
    text?: boolean;
    /** Page titles. */
    title?: boolean;
    /** URL query values. */
    query?: boolean;
    /** JavaScript errors and failed resources. */
    errors?: boolean;
    /** Failed and slow fetch and XMLHttpRequest calls. */
    network?: boolean;
    /** Form start, invalid submit and field details. */
    forms?: boolean;
}
/**
 * Who the user is, beyond the ID. email, name and phone are shown on their profile and are
 * searchable; they never link two people. Any other key is a user property and passes the same
 * privacy rules as track() properties.
 */
export interface IdentifyOptions {
    /** Opaque workspace or organisation ID. Never a name or email. */
    account?: string | number;
    email?: string;
    name?: string;
    phone?: string;
    [trait: string]: Property | undefined;
}
export interface GrantOptions {
    method?: 'banner' | 'settings' | 'api' | 'cmp';
    /** The customer's privacy notice version, at most 64 characters. */
    policyVersion?: string;
    /** Only from an explicit user action: lets a grant override Global Privacy Control. */
    overrideGPC?: boolean;
}
export interface DatacubClient {
    init(publicKey: string, options?: InitOptions): void;
    track(event: string, properties?: Properties): void;
    identify(userId: string | number, options?: IdentifyOptions): void;
    /** The same with the id inside: identify({ id: 'u_42', email, plan: 'pro' }). */
    identify(profile: IdentifyOptions & {
        id?: string | number;
        userId?: string | number;
        user_id?: string | number;
    }): void;
    reset(): void;
    consent: {
        grant(options?: GrantOptions): void;
        revoke(): void;
    };
    /** Added by the feedback widget (start() from @datacub/web/feedback, or /v1/feedback.js): show one question now. */
    ask?(questionId: string, options?: {
        into?: Element | string;
    }): void;
    /** Added by the feedback module: open the "Send feedback" card. */
    feedback?(): void;
    /**
     * Added by the script-tag flags module (/v1/flags.js; with npm, import flag from @datacub/web/flags): is this feature flag on for this
     * visitor? false when it is off, unknown, or cannot be decided (before consent, offline).
     */
    flag?(key: string): Promise<boolean>;
    /**
     * Added by the flags module: this visitor's version of an experiment, 'A' (the original) or 'B'.
     * Records that they saw it. 'A' when it is not running or cannot be decided.
     */
    experiment?(key: string): Promise<'A' | 'B'>;
    /** @internal the feedback and flags modules' way in */
    _fb(): unknown[];
}
declare const datacub: DatacubClient;
export default datacub;

export type Overview = {
  verified_cash_collections?: Array<{currency:string;amount_minor:string;payment_count:number}>;
  as_of: string;
  businesses: { total: number; by_status: Array<{ status: "active" | "restricted" | "cancelled"; count: number }> };
  subscriptions: {
    active: number;
    trial: number;
    grace: number;
    past_due: number;
    restricted: number;
    cancelled: number;
    missing: number;
    lifecycle: {
      expired_trials: number;
      expired_grace: number;
      incomplete_trials: number;
      incomplete_grace: number;
    };
  };
  attention: { failed_jobs: number; failed_notifications: number };
  recent_businesses: Array<{ id: string; name: string; slug: string; status: "active" | "restricted" | "cancelled"; created_at: string }>;
};

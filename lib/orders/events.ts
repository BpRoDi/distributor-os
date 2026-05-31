export type OrderEventRecord = {
  eventType: string;
  label: string;
  createdAt?: string;
};

export const requiredOrderEventTypes = [
  "product_imported",
  "message_pasted",
  "draft_generated",
  "brand_approved",
  "link_created",
  "distributor_confirmed",
  "payment_requested",
  "payment_paid",
] as const;

export function appendOrderEventRecord(
  events: OrderEventRecord[],
  eventType: string,
  label: string,
  createdAt = new Date().toISOString()
) {
  if (events.some((event) => event.eventType === eventType)) return events;
  return [...events, { eventType, label, createdAt }];
}

export function createOrderEventTimeline(events: OrderEventRecord[]) {
  return requiredOrderEventTypes.map((eventType) => {
    const event = events.find((item) => item.eventType === eventType);
    return {
      eventType,
      label: event?.label || eventType.replace(/_/g, " "),
      done: Boolean(event),
      createdAt: event?.createdAt,
    };
  });
}

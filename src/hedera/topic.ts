import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TopicId,
  Client,
} from "@hashgraph/sdk";
import { operatorKey } from "./client.js";
import type { LedgerEvent } from "../vault/types.js";

/**
 * The HCS topic is the protocol's tamper-evident, timestamped state-transition log: NAV
 * heartbeats + every lifecycle event. Private (submitKey) so only the protocol writes; anyone
 * reads via the Mirror Node. This is the "verifiable-by-construction" trust story. SPEC.md §3.4.
 */
export async function createNavTopic(client: Client, memo: string): Promise<TopicId> {
  const tx = await new TopicCreateTransaction()
    .setTopicMemo(memo)
    .setSubmitKey(operatorKey)
    .setAdminKey(operatorKey)
    .freezeWith(client)
    .sign(operatorKey);

  const receipt = await (await tx.execute(client)).getReceipt(client);
  if (!receipt.topicId) throw new Error("topic create returned no topicId");
  return receipt.topicId;
}

/**
 * Publish one event. Keep each message <= 1024 bytes so it's a single chunk and trivially
 * queryable from the Mirror Node. Larger payloads are auto-chunked but avoid that here.
 */
export async function publishEvent(client: Client, topicId: TopicId, event: LedgerEvent): Promise<void> {
  const message = JSON.stringify(event);
  if (Buffer.byteLength(message) > 1024) {
    throw new Error(`HCS event is ${Buffer.byteLength(message)}B, keep it under 1024B`);
  }
  const tx = await new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(message)
    .freezeWith(client)
    .sign(operatorKey);
  await (await tx.execute(client)).getReceipt(client);
}

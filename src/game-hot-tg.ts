import {
  near,
  json,
  TypedMap,
  BigInt,
  log,
  JSONValue,
  Bytes,
} from '@graphprotocol/graph-ts';
import { BuyEvent, ClaimEvent, User } from "../generated/schema"

export function handleReceipt(receipt: near.ReceiptWithOutcome): void {
  const actions = receipt.receipt.actions;

  for (let i = 0; i < actions.length; i++) {
    handleAction(
      actions[i],
      receipt,
    );
  }
}

export function handleAction(
  action: near.ActionValue,
  receipt: near.ReceiptWithOutcome,
): void {
  if (action.kind != near.ActionKind.FUNCTION_CALL) {
    return;
  }
  const outcome = receipt.outcome;
  const methodName = action.toFunctionCall().methodName;
  const args = action.toFunctionCall().args;

  for (let logIndex = 0; logIndex < outcome.logs.length; logIndex++) {
    let outcomeLog = outcome.logs[logIndex].toString();
    if (outcomeLog.startsWith('EVENT_JSON:')) {
      outcomeLog = outcomeLog.replace('EVENT_JSON:', '');
      const jsonData = json.try_fromString(outcomeLog);
      const jsonObject = jsonData.value.toObject();
      const event = jsonObject.get('event')!;
      const dataArr = jsonObject.get('data')!.toArray();
      const dataObj: TypedMap<string, JSONValue> = dataArr[0].toObject();
      log.debug('event: {} ', [event.toString()]);
      
      if (event.toString() == 'ft_mint') handleClaim(dataObj, receipt);
      if (methodName == 'buy_asset') handleTransfer(dataObj, receipt, args);
      // if (methodName == 'join_village') handleTransfer(dataObj, receipt, args);
    }
  }
}

export function handleClaim(
  data: TypedMap<string, JSONValue>,
  receipt: near.ReceiptWithOutcome,
): void {
  const receiptHash = receipt.receipt.id.toBase58();
  const user_address = data.get('owner_id')!.toString();
  const amount = BigInt.fromString(data.get('amount')!.toString());
  const timestamp = receipt.block.header.timestampNanosec;

  let claimEvent = new ClaimEvent(receiptHash);
  const user = getUser(user_address);
  user.claimed = amount.plus(user.claimed);

  claimEvent.user = user.id;
  claimEvent.amount = amount;
  claimEvent.timestamp = BigInt.fromU64(timestamp);
  claimEvent.save();

  user.claimEvents = user.claimEvents.concat([claimEvent.id]);
  user.save();
}


export function handleTransfer(
  data: TypedMap<string, JSONValue>,
  receipt: near.ReceiptWithOutcome,
  args: Bytes,
): void {
  const receiptHash = receipt.receipt.id.toBase58();
  const user_address = data.get('old_owner_id')!.toString();
  const new_owner_address = data.get('new_owner_id')!.toString();
  const amount = data.get('amount')!.toString();

  const timestamp = receipt.block.header.timestampNanosec;
  const jsonData = json.try_fromBytes(args);
  const jsonObject = jsonData.value.toObject();
  const assetId = jsonObject.get('asset_id')!;

  log.error('event assetId:{} {}', [args.toString(), receiptHash]);

  let buyEvent = new BuyEvent(receiptHash);
  const user = getUser(user_address);
  buyEvent.asset_id = assetId.toBigInt();
  buyEvent.amount = BigInt.fromString(amount);
  buyEvent.old_owner_id = user_address;
  buyEvent.new_owner_id = new_owner_address;
  buyEvent.timestamp = BigInt.fromU64(timestamp);

  user.buyEvents = user.buyEvents.concat([buyEvent.id]);

  buyEvent.save();
  user.save();
}

export function getUser(user_address: string): User {
  let user = User.load(user_address);
  if (!user) {
    user = new User(user_address);
    user.claimed = BigInt.zero();
    user.claimEvents = [];
    user.buyEvents = [];
    user.save();
  }
  return user;
}
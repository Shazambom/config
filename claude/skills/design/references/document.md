# Document format

Use this as a shape example, not a required architecture. Replace the sample paths and contracts with the inspected project's names. Omit sections that do not apply. The design file itself contains only code fences like these.

```text
scope {
  plan: <existing-plan-reference>
  repository_revision: <commit>
  modules: [api/create.go, orders/service.go, orders/store.go, events/order.go]
}
```

```diff
 module api/create.go
-fn CreateOrder(ctx: Context, body: RawBody) -> HttpResponse
+fn CreateOrder(ctx: Context, request: CreateOrderRequest) -> Result<OrderResponse, ApiError>

+struct CreateOrderRequest {
+  customer_id: CustomerId
+  items: NonEmptyList<OrderItem>
+  idempotency_key: IdempotencyKey
+}

 module orders/service.go
-fn PlaceOrder(customer: Customer, items: List<OrderItem>) -> Order
+fn PlaceOrder(ctx: Context, command: PlaceOrderCommand) -> Result<OrderReceipt, PlaceOrderError>

+struct PlaceOrderCommand {
+  customer_id: CustomerId
+  items: NonEmptyList<OrderItem>
+  idempotency_key: IdempotencyKey
+}

+struct OrderReceipt {
+  order_id: OrderId
+  status: OrderStatus
+}

+enum PlaceOrderError { CustomerNotFound, InvalidItems, StoreUnavailable }

 module orders/store.go
+interface OrderStore {
+  Insert(ctx: Context, order: NewOrder, key: IdempotencyKey) -> Result<OrderId, StoreError>
+}

 module events/order.go
+struct OrderPlaced {
+  order_id: OrderId
+  customer_id: CustomerId
+}

+interface OrderEvents {
+  Publish(ctx: Context, event: OrderPlaced) -> Result<Void, PublishError>
+}
```

```text
[Client]
    | CreateOrderRequest
    v
[api/CreateOrder] -- PlaceOrderCommand --> [orders/PlaceOrder]
    ^                                          |          |
    | OrderResponse | ApiError                 |          | OrderPlaced
    |                                          |          v
    +------ OrderReceipt | PlaceOrderError ----+     [events/OrderEvents]
                                               |
                                               | NewOrder + IdempotencyKey
                                               v
                                         [orders/OrderStore]
                                               |
                                               | OrderId | StoreError
                                               v
                                         [orders/PlaceOrder]

UNRESOLVED publication_failure: AtomicOutbox | RetryablePublish | BestEffort
UNRESOLVED duplicate_key: ReturnExistingReceipt | Conflict
```

`NewOrder` and the other referenced types are unchanged in this example. Include their declarations when your proposal changes them.

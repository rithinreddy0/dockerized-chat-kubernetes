# GitHub and free hosting

The repository root includes `render.yaml` for a free Render demonstration deployment. It creates one Docker web service and one internal Redis-compatible Key Value datastore in the same region. Both explicitly use `plan: free`; there are no paid disks or paid replicas in the Blueprint.

## Deploy

1. Sign in to Render and connect the GitHub account that owns this private repository.
2. Choose **New → Blueprint** and select `dockerized-chat-kubernetes`.
3. Use branch `main` and Blueprint path `render.yaml`.
4. Review the two resources. Both must show the **Free** plan. If Render requests an upgrade, reports an existing free-datastore limit, or adds paid resources, stop instead of accepting charges or replacing unrelated services.
5. Deploy the Blueprint. Render builds React inside the Dockerfile and starts Node.js. The datastore connection is supplied internally through `REDIS_URL`; do not copy it into GitHub.
6. Open the web service's HTTPS URL. Test two distinct browser tabs with different names, direct messages, and a named group. Check `/health/ready` for HTTP 200.

If the suggested service name is already taken, change its name before creation. Keep the two resources in the same region, and update `fromService.name` if you change the datastore's name.

Render's connected-account access is required to perform deployment. Adding a Blueprint to GitHub is preparation, not proof that the app is live.

## Free-plan tradeoffs

- The web service can sleep after 15 minutes without traffic; the next visit may take about a minute to wake it.
- The free web service runs a single instance. This hosted demo does not demonstrate Kubernetes replica scaling; use the included Minikube lab for that.
- The free Key Value datastore is Redis-compatible (new instances currently use Valkey). The Docker Compose and Kubernetes course setup still uses the official Redis image.
- The free datastore does not persist data across restarts. Profiles, groups, membership and messages may disappear when it restarts.
- Render permits only one free Key Value instance per workspace and applies usage limits. Do not upgrade an existing account's resources to make room for this demo.
- Free usage has limits. Avoid adding a payment method or accepting an upgrade if you need strictly zero-cost hosting; exceeding some allowances can suspend free services instead.

This remains a small classroom chat app with unverified display names and open groups. Use nicknames and test messages on the hosted demo. It has no end-to-end encryption or production account system.

## References

- [Render free plans and limits](https://render.com/docs/free)
- [Render Key Value](https://render.com/docs/key-value)
- [Blueprint specification](https://render.com/docs/blueprint-spec)
- [WebSocket support](https://render.com/docs/websocket)

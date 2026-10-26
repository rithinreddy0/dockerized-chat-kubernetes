# DevOps lab

Run from the project root after following the Kubernetes setup in README.md. All resources use namespace `course-chat`.

## 1. Inspect pods and expose the service

```sh
kubectl -n course-chat get deployments
kubectl -n course-chat get pods -o wide
kubectl -n course-chat get services
kubectl -n course-chat get endpointslices -l kubernetes.io/service-name=chat
minikube service chat -n course-chat --url
```

Expected: two ready chat pods, one Redis pod, the NodePort chat Service and internal Redis ClusterIP Service. Open the printed URL in separate tabs, enter different names, select each other under People, and exchange direct messages. Create a group and open it in both tabs for group messaging.

Expand Server details in each desktop sidebar to see the socket server. The Service does not guarantee alternating pods; open fresh tabs if both reach the same one. Existing sockets stay on their pod.

## 2. Service discovery

```sh
kubectl -n course-chat exec deployment/chat -- node -e "require('node:dns').lookup('redis',console.log)"
kubectl -n course-chat exec deployment/redis -- redis-cli ping
kubectl -n course-chat get configmap chat-config -o yaml
```

Expected: `redis` resolves to its Service address, PING returns PONG, and REDIS_URL uses `redis://redis:6379`. The short DNS name resolves within the namespace; the default full name is `redis.course-chat.svc.cluster.local`.

## 3. Replica scaling

```sh
kubectl -n course-chat scale deployment/chat --replicas=4
kubectl -n course-chat rollout status deployment/chat --timeout=180s
kubectl -n course-chat get pods -l app=chat
```

Expected: four ready chat pods. Open fresh client tabs and exchange direct and group messages across replicas. Redis forwards the appropriate user/group events. Existing sockets are not moved. Keep Redis at one replica; duplicating independent Redis instances does not create a Redis cluster.

```sh
kubectl -n course-chat scale deployment/chat --replicas=2
```

Affected clients reconnect to a surviving pod with their tab tokens. Reapplying the manifest also restores its declared count of two.

## 4. Rolling update

Make a small label change in `client/src/App.jsx`, then:

```sh
docker build -t course-chat:1.1.0 .
minikube image load course-chat:1.1.0
```

Edit `k8s/chat-deployment.yaml`: change the image to `course-chat:1.1.0` and add this entry beside INSTANCE_ID in the container's existing `env` list:

```yaml
            - name: APP_VERSION
              value: "1.1.0"
```

Then:

```sh
kubectl apply -f k8s/chat-deployment.yaml
kubectl -n course-chat rollout status deployment/chat --timeout=180s
kubectl -n course-chat get pods -l app=chat -w
```

End the watch with Ctrl+C. `maxSurge: 1` permits one extra pod, `maxUnavailable: 0` preserves available replica count during controlled replacement, and `minReadySeconds: 5` requires stable readiness. Spare capacity is needed.

Keep chat tabs open during the update. Affected sockets reconnect, resume their user IDs and reopen the current conversation. Refresh after rollout to load new static assets and check the version under Server details. A refresh preserves the tab identity but returns the UI to conversation selection.

## 5. Roll back

```sh
kubectl -n course-chat rollout history deployment/chat
kubectl -n course-chat rollout undo deployment/chat
kubectl -n course-chat rollout status deployment/chat --timeout=180s
```

Expected: the previous pod template returns, including its image and explicit version environment. Refresh the frontend. Rollback changes the live Deployment; restore the desired values in the local manifest before applying it again. Separate ConfigMap edits are not part of Deployment revision history, which is why the version change above is inside the pod template.

## 6. Self-healing and Redis recovery

```sh
kubectl -n course-chat get pods -l app=chat
kubectl -n course-chat delete pod <one-chat-pod-name>
kubectl -n course-chat get pods -l app=chat -w
```

Expected: the Deployment replaces the selected chat pod; affected clients resume on another pod. Reopen conversations if needed to fetch retained history.

To demonstrate the single-Redis limitation, send messages and delete only the Redis pod by its name. Chat becomes temporarily unavailable while Redis restarts. The existing PVC is reused, so persisted state should return, subject to disk/Redis durability. Liveness of the Node pods remains independent of Redis; readiness fails while the dependency is unavailable.

## 7. Prove cross-pod delivery directly

Select two different chat pod names and run one command per terminal:

```sh
kubectl -n course-chat port-forward pod/<first-chat-pod> 8081:3000
kubectl -n course-chat port-forward pod/<second-chat-pod> 8082:3000
```

Open http://localhost:8081 and http://localhost:8082 in separate tabs. Enter different names, select each other and exchange DMs. Create/open a group in both tabs and send group messages too. Expand Server details: the two replica names must differ. A third tab should not see the two users' direct history when it selects either person; it has its own conversation pair.

These direct pod forwards make the proof unambiguous; NodePort remains the service-exposure exercise. Port-forwarding a Service selects a single pod rather than balancing each browser tab.

## Submission evidence

- Two distinct replica names with a working direct conversation.
- A named group with messages between both replicas.
- `get pods,svc,pvc` showing the baseline and bound Redis storage.
- Redis DNS lookup and PONG response.
- Four ready chat pods after scaling.
- Successful rolling update and rollback.
- Replacement pod and resumed session after deleting one chat pod.

Record the command, observed result and a short explanation for each exercise.

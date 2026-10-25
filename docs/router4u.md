# Connect a Personal Codex Account Through Router4U

This procedure optionally uses a real model from the NOVAIL development server through Router4U's `personal` connection. Account connection, readiness checks, and real inference are separate stages. Successful sign-in or model listing does not guarantee inference success or model entitlement.

## 1. Install and access Router4U

Build a pinned, verified upstream revision on a Linux amd64 Docker host.

```sh
git clone https://github.com/slop-lab/router4u.git
cd router4u
git checkout a6709ad6e892d4b26bd7d7cf611a76b29436c0a0
docker build --platform linux/amd64 -t router4u:novail-a6709ad6 .
docker run -d --name novail-router4u --restart unless-stopped --stop-timeout 30 \
  --read-only --tmpfs /tmp \
  --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 \
  -p 127.0.0.1:9470:9470 \
  -v novail-router4u-data:/var/lib/router4u \
  -v novail-router4u-transcripts:/var/lib/router4u-transcripts \
  router4u:novail-a6709ad6
docker inspect --format '{{.State.Status}} / {{.State.Health.Status}}' novail-router4u
```

Wait for `running / healthy`. A printed container ID alone does not show that initialization succeeded. Open `http://127.0.0.1:9470/` locally.

In DIM, use the HTTPS URL printed by `dim-development-service expose --name router4u --port 9470 --ingress https-ts --require-scheme https`. This command exposes a workspace-accessible local port, so a remote Docker daemon requires a local bridge first. Do not assume a DIM workspace's `/tmp` bridge or exposure survives a reboot; recheck Router4U and reconnect it. Never expose internal backend port `8317` or OAuth callback port `1455`.

Read the admin key directly on the host only when needed. Never paste the real output of this command into chat, an issue, logs, or a commit.

```sh
docker exec novail-router4u router4u admin-key show
```

The admin key is only for control-room sign-in. Do not use it as NOVAIL's `OPENAI_API_KEY`.

## 2. Connect personal Codex and create a project key

1. In the Router4U control room, choose **Connections -> personal -> Connect Codex**.
2. On the provider page, sign into your own account with **Sign in with ChatGPT**.
3. If the browser redirects to `localhost:1455` and the page does not open, copy the complete callback URL from the address bar and paste it directly into the Router4U dialog. Never share that callback URL in chat or the repository.
4. Under **Set up models -> Load available models**, load the catalog, select only the models you intend to use, and activate the connection. Catalog access alone does not verify entitlement.
5. Under **Projects & keys**, create a NOVAIL project and allow only the required `personal` route and models.
6. Issue a project key. Its default scopes include `inference` and `usage:read`. Use only this project key with NOVAIL, never the admin key or OAuth credentials.

Use a Codex connection only with a personal account you own and for your own workload. Do not provide account access to others or distribute or resell credentials. Review the provider's current terms and limits yourself.

## 3. Configure the NOVAIL environment

Activate Node.js 24.22.0 or later, install dependencies, and create the repository's ordinary environment file. If `.env` already exists, skip the copy and edit only the required provider fields.

```sh
cp .env.example .env
chmod 600 .env
pnpm install
```

Edit `.env` directly.

```dotenv
OPENAI_BASE_URL=http://127.0.0.1:9470/v1
OPENAI_API=responses
OPENAI_API_KEY=<Router4U project key>
# Optional default; select the model in NOVAIL's web UI.
OPENAI_MODEL=
PORT=3000
```

- You do not need `OPENAI_MODEL` when selecting a catalog model in the web UI. Set it only as a default or for the CLI generation check, using the exact catalog ID. Never guess a default GPT identifier.
- If Router4U is at another address, as in DIM, set `OPENAI_BASE_URL` to the gateway address reachable from the NOVAIL server plus `/v1`. The browser control-room URL and server-reachable URL may differ.
- `.env` and other `.env.*` files are ignored by Git. Never expose a project key in shell history, chat, browser client code, or a commit.
- There is no separate Router4U-specific NOVAIL state or startup path. To test away from a real manuscript, set `NOVAIL_DATA_FILE` to a temporary path created by the owner. The generation probe always uses temporary storage.

Only when the current shell's Node version is too old and a version manager is not immediately available, run the check in this form. The standard procedure is to activate the repository's Node 24.22.0 from `.node-version`.

```sh
npx --yes --package=node@24.22.0 --package=pnpm@12.5.1 pnpm provider:check
```

## 4. Distinguish readiness from real inference

First run the read-only readiness check.

```sh
pnpm provider:check
```

This command calls only an authenticated standard `GET /v1/models`. It checks whether the key is accepted and a selected model appears in the catalog, but it performs no inference and proves nothing about Chat Completions, streaming, tools, strict JSON Schema, real entitlement, or response quality. If the gateway returns 404 or 405 for the model-list API, the check reports the catalog as `UNAVAILABLE` without declaring the gateway incompatible.

The CLI generation check requires an exact model ID in `OPENAI_MODEL`. Run it only after explicitly consenting to a real provider call and quota usage.

```sh
pnpm provider:check --generate
```

`--generate` creates an isolated Part run from the default seed in a temporary directory, exercises NOVAIL's read-only tools, streaming, tool loop, and strict JSON Schema result path, then deletes the temporary state. It does not touch user files or the canonical head, but it may consume provider quota.
If the output is semantically identical to the seed, the `NO_CHANGES` validation issue may block Adopt; that can be an expected probe result. Errors remain failures and are never replaced with Local example (not AI) results. This probe checks connection compatibility, not literary quality, real user-flow adoption, or general model reliability.

## 5. Start and expose NOVAIL

NOVAIL reads `.env` through its ordinary startup command without a Router4U-specific wrapper. An empty key starts explicit Local example (not AI) mode. With a key, NOVAIL validates the base URL; the server can start without a default model so that users can choose one in the web UI.

```sh
pnpm start
```

The default port in `.env.example` is `3000`. If an existing preview owns the port, identify its owner and stop it cleanly or select another `PORT` in `.env`. Never terminate all Node processes indiscriminately.

In DIM, expose the selected port from another terminal and use the exact URL printed by the tool.

```sh
dim-development-service expose --name novail --port 3000 --ingress https-ts --require-scheme https
```

After opening the server, create a Run in the web UI to perform inference through the real user flow. Passing a readiness check does not mean a real Run occurred.

If a Codex route rejects Chat Completions with `unsupported_capability`, use `OPENAI_API=responses`. Check the actual model and route, and verify with a new Run rather than automatically retrying an existing failure. A successful catalog request does not guarantee the complete Revision tool loop.

## 6. Lifecycle and data responsibility

```sh
docker stop -t 30 novail-router4u
docker start novail-router4u
docker inspect --format '{{.State.Status}} / {{.State.Health.Status}}' novail-router4u
```

Stopping and starting the container preserves the `novail-router4u-data` and `novail-router4u-transcripts` named volumes. Reattach both volumes when replacing the container, and never let two installations use the same volumes simultaneously.
The first volume contains Router4U configuration, keys, OAuth credentials, and operational state. The transcript volume can contain request and response bodies with manuscript text and audit records. Treat both as sensitive and back them up together while stopped before deletion, restoration, or migration.

A healthy container does not prove successful account sign-in, route activation, model selection, project policy, or real inference. After a reboot, independently recheck Docker health, any temporary bridge, DIM exposure, and NOVAIL readiness.

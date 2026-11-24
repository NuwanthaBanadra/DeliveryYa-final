# Deploying Deliveryya to a Docker VPS

The GitHub Actions workflow builds and tests the WAR on pull requests and pushes to `main`. After a successful build on `main`, it copies the WAR over SSH and replaces the `deliveryya` container. Manual runs are also supported **on main only**. This is a single-container deployment, so there is downtime while Tomcat restarts.

Deliveryya uses Spring Boot 4 and a WAR; the deployment uses **Tomcat 11 with Java 21**, not the Tomcat 10.1 image used by Manju Shoe Center. It binds `127.0.0.1:8082` on the VPS to container port 8080, leaving 8081 available for the other app. Configure your existing reverse proxy to forward Deliveryya's domain to `http://127.0.0.1:8082`; configure HTTPS there. `server.port` in the packaged properties does not change the port of an external Tomcat.

## Application configuration and security

As requested, the application continues to use its existing packaged `application.properties` and Firebase service-account JSON. No external application properties file, `.env` file, or separate Firebase file is required for this deployment.

**Security risk:** credentials remain in the repository and will also be present in the built WAR and GitHub Actions artifact. Restrict access to the repository, artifacts, and VPS. Plan to rotate the exposed credentials and move them out of the repository and deployment package when you are ready; removing them later will not remove them from Git history or existing copies. Rotating signing secrets can invalidate existing tokens.

## 1. Prepare the VPS

Install Docker and the Docker Compose-free `docker` command, plus `curl` and `bash`. The SSH deployment user must be able to run `docker` without an interactive password and write to `/opt/apps/deliveryya`; Docker access is effectively root-level access. Restrict that user's access appropriately. The VPS must be reachable over SSH from GitHub-hosted runners and be able to pull the Tomcat image and reach the production database, mail, Firebase and SMS services. Ensure port 8082 is free.

For example, as an administrator on the VPS (replace `DEPLOY_USER` with your actual SSH user):

```sh
sudo mkdir -p /opt/apps/deliveryya/uploads
sudo chown -R DEPLOY_USER:DEPLOY_USER /opt/apps/deliveryya
```

If Docker runs containers as an unprivileged/remapped user on your VPS, ensure it can read the WAR and write to the uploads directory. Uploads remain on the VPS across deployments; back them up independently.

**Back up the production database before the first deployment.** The current configuration uses `spring.jpa.hibernate.ddl-auto=update`, so application startup can change the schema, and rolling back the WAR will not roll those changes back. Review and control schema changes before production deployment.

## 2. Configure GitHub

In the repository's **Settings → Secrets and variables → Actions**, add these repository secrets:

- `VPS_HOST`: VPS hostname or IP address (no `https://`).
- `VPS_USER`: SSH deployment username.
- `VPS_SSH_PRIVATE_KEY`: private key for that user; install its matching public key in the user's `~/.ssh/authorized_keys` on the VPS. Use a dedicated key without an interactive passphrase.
- `VPS_KNOWN_HOSTS`: the VPS SSH host-key line(s) in OpenSSH `known_hosts` format. Obtain them and verify their fingerprints through a trusted independent channel before adding them. Do not blindly trust a network scan.

Optional repository variable `VPS_SSH_PORT` defaults to `22`. For a non-default port, the known-hosts entry should use `[hostname]:port`. The workflow does not need application credentials as GitHub secrets; they are currently packaged in the WAR. Restrict access to the repository and the production VPS. No VPS address or private key needs to be shared in chat.

## 3. Deploy and inspect

Merge the workflow into `main` after the VPS and GitHub settings are ready. A push to `main` builds and tests against an isolated MySQL service, then deploys only if the build succeeds. You can also select **Actions → Build and deploy Deliveryya → Run workflow**, choosing `main`. Pull requests only build and test; they cannot deploy.

The deployment pulls the Tomcat image before stopping the container, saves the previous WAR as `/opt/apps/deliveryya/app.war.previous`, replaces the WAR, and starts the container. It checks for Spring Security's HTTP 401 response on an unauthenticated probe for up to roughly two minutes; this is a startup check, not a full end-to-end health check. On failure, the workflow fails and the previous WAR remains on disk, but **rollback is not automatic**. Investigate first:

```sh
docker ps -a --filter name=deliveryya
docker logs --tail 200 deliveryya
curl -i http://127.0.0.1:8082/api/v1/__deployment_probe__
```

To restore the previous WAR after evaluating database compatibility, stop and remove the failed container, copy `app.war.previous` to `app.war`, then rerun the same `docker run` command in `deploy/deploy.sh` (with the paths shown there). Do not replace a bind-mounted WAR while its container is running. A database restore or migration may also be necessary; consult your database backup and recovery procedure. Restrict deployment access and monitor logs after a release.

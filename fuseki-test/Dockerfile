# A Fuseki for docker-compose.mcp-https-image.yml, built from the release jar
# on Maven Central.
#
# Apache publishes no Fuseki image. The compose file used to name
# `fuseki:5.5.0-3`, the tag Jena's jena-fuseki-docker tooling produces when
# someone runs it by hand — so `docker compose up` failed with "pull access
# denied" on any machine that had not. This builds the same server from the
# published artifact instead.
#
# Alpine for busybox `wget`, which the compose healthcheck calls.
FROM eclipse-temurin:21-jre-alpine

ARG FUSEKI_VERSION=5.5.0
ADD https://repo1.maven.org/maven2/org/apache/jena/jena-fuseki-server/${FUSEKI_VERSION}/jena-fuseki-server-${FUSEKI_VERSION}.jar /opt/fuseki/fuseki-server.jar

RUN mkdir -p /fuseki/databases /opt/fuseki/configuration

EXPOSE 3030

# `--ping` enables /$/ping, which the healthcheck polls; Fuseki main serves no
# admin endpoints unless asked.
ENTRYPOINT ["java", "-jar", "/opt/fuseki/fuseki-server.jar", "--ping", "--port=3030", "--config=/opt/fuseki/configuration/config.ttl"]

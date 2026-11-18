# Multi-stage build: Maven → slim JRE. Configure with the environment variables in .env.example / README §5.
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn -q -B dependency:go-offline
COPY src ./src
RUN mvn -q -B -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app
# pom.xml names the jar <finalName>backend</finalName> (DockerfileTest keeps the two in step).
COPY --from=build /app/target/backend.jar app.jar
ENV APP_PROFILE=postgres FILE_STORAGE_PATH=/data/storage SERVER_PORT=8080
VOLUME ["/data/storage"]
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]

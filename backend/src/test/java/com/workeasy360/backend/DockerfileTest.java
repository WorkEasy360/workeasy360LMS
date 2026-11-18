package com.workeasy360.backend;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("The image build copies the jar the Maven build produces")
class DockerfileTest {

    @Test
    @DisplayName("Dockerfile's COPY names target/<finalName>.jar from pom.xml")
    void copiesTheBuiltJar() throws IOException {
        Path dockerfile = Path.of("Dockerfile");
        // Inside the image's own build stage only pom.xml and src/ are present (and tests are skipped there).
        assumeTrue(Files.exists(dockerfile), "run from the backend module directory");
        Matcher finalName = Pattern.compile("<finalName>([^<]+)</finalName>").matcher(Files.readString(Path.of("pom.xml")));
        assertThat(finalName.find()).as("pom.xml names the jar").isTrue();
        assertThat(Files.readString(dockerfile))
                .contains("COPY --from=build /app/target/" + finalName.group(1) + ".jar app.jar");
    }
}

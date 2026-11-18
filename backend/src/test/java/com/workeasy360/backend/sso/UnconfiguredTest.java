package com.workeasy360.backend.sso;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

/** A deployment with none of the WORKEASY360_* settings runs exactly as before. */
@EnabledIfEnvironmentVariable(named = "LMS_TEST_DB_URL", matches = ".+", disabledReason = "needs PostgreSQL: set LMS_TEST_DB_URL")
@SpringBootTest(properties = "spring.profiles.active=test")
@AutoConfigureMockMvc
@DisplayName("Without WorkEasy360 settings: WorkEasyLMS starts, and its sign-in page does not offer WorkEasy360")
class UnconfiguredTest {

    @Autowired private MockMvc mvc;

    @Test
    void unconfigured() throws Exception {
        mvc.perform(get("/api/auth/workeasy360/config")).andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(false)).andExpect(jsonPath("$.ssoOnly").value(false));
        mvc.perform(get("/api/auth/workeasy360/start")).andExpect(status().isFound())
                .andExpect(header().string("Location", "/#/login?sso_error=unavailable"));
        mvc.perform(get("/api/courses")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/public/plans")).andExpect(status().isOk());
    }
}

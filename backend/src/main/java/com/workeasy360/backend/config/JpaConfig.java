package com.workeasy360.backend.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

// Repository interfaces are grouped as nested members of Repos (repo/Repos.java) for readability;
// considerNestedRepositories tells Spring Data JPA's classpath scan to pick those up too.
@Configuration
@EnableJpaRepositories(basePackages = "com.workeasy360.backend.repo", considerNestedRepositories = true)
public class JpaConfig {
}

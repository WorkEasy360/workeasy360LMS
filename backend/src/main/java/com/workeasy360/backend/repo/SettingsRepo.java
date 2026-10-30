package com.workeasy360.backend.repo;

import com.workeasy360.backend.domain.Settings;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface SettingsRepo extends JpaRepository<Settings, String> {
    Optional<Settings> findByOrgId(String orgId);
}

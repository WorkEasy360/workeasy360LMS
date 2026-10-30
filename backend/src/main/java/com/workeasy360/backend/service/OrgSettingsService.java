package com.workeasy360.backend.service;

import com.workeasy360.backend.domain.Organization;
import com.workeasy360.backend.domain.Settings;
import com.workeasy360.backend.repo.Repos.OrganizationRepo;
import com.workeasy360.backend.repo.SettingsRepo;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * One Settings row per organization. The pre-tenancy deployment had a single 'singleton' row, which now belongs to
 * the default organization; every other organization gets its own row on first access, seeded with the same
 * defaults the schema always used.
 */
@Service
public class OrgSettingsService {
    private final SettingsRepo settings; private final OrganizationRepo orgs;
    public OrgSettingsService(SettingsRepo settings, OrganizationRepo orgs) { this.settings = settings; this.orgs = orgs; }

    @Transactional
    public Settings forOrg(String orgId) {
        String org = orgId == null || orgId.isBlank() ? Organization.DEFAULT : orgId;
        return settings.findByOrgId(org).orElseGet(() -> {
            String orgName = orgs.findById(org).map(Organization::getName).orElse("Your organisation");
            return settings.save(Settings.builder()
                    .id("s-" + org).orgId(org).orgName(orgName).supportEmail("support@workeasy360.com") // settings.id is varchar(20): "s-" + a 16-char org id fits
                    .certExpiryDefault(12).guidesEnabled(true).communityEnabled(true).brandHue(250)
                    .maxVideoMb(200).instructorPublish(true).build());
        });
    }
}

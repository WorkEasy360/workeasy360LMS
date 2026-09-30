package com.workeasy360.backend.web;

import com.workeasy360.backend.domain.Certificate;
import com.workeasy360.backend.dto.CertificateDtos.CertificateDto;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.service.CertificateService;
import com.workeasy360.backend.service.PermissionService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/certificates")
public class CertificateController {
    private final CertificateService service;
    private final PermissionService perm;
    public CertificateController(CertificateService service, PermissionService perm) { this.service = service; this.perm = perm; }

    @GetMapping
    public List<CertificateDto> list(@AuthenticationPrincipal CurrentUser user, @RequestParam(defaultValue = "false") boolean all) {
        List<Certificate> certs = (all && perm.isAdmin(user)) ? service.all() : service.forUser(user.getId());
        return certs.stream().map(c -> CertificateDto.of(c, service.status(c).name())).toList();
    }

    @GetMapping("/verify/{number}")
    public CertificateDto verify(@PathVariable String number) {
        Certificate c = service.verify(number).orElseThrow(() -> ApiException.notFound("Certificate"));
        return CertificateDto.of(c, service.status(c).name());
    }

    @PostMapping("/{id}/revoke")
    public void revoke(@AuthenticationPrincipal CurrentUser user, @PathVariable String id) {
        if (!perm.isAdmin(user)) throw ApiException.forbidden("Only an admin can revoke a certificate");
        service.revoke(id);
    }

    @PostMapping("/{id}/renew")
    public CertificateDto renew(@AuthenticationPrincipal CurrentUser user, @PathVariable String id) {
        Certificate c = service.renew(id);
        return CertificateDto.of(c, service.status(c).name());
    }
}

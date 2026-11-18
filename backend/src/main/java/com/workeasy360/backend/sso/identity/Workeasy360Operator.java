package com.workeasy360.backend.sso.identity;

import com.workeasy360.backend.domain.Organization;
import com.workeasy360.backend.repo.Repos.OrganizationRepo;
import com.workeasy360.backend.service.AuditService;
import com.workeasy360.backend.sso.Workeasy360Properties;
import java.io.PrintStream;
import java.time.Clock;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Operator commands for the WorkEasy360 links, run from the application jar with the service's own environment,
 * without starting the web server ({@code java -jar backend.jar w360sso <command> ...}; docs/workeasy360-sso.md):
 *
 * <pre>
 *   w360sso list                                                       every organization and what it is linked to
 *   w360sso link --workeasy360-organization=&lt;uuid&gt; --organization=&lt;org id&gt;   link an existing WorkEasyLMS organization
 *   w360sso unlink --workeasy360-organization=&lt;uuid&gt;                         remove a link (people stay; see the docs)
 *   w360sso move-issuer --from=&lt;issuer&gt; --to=&lt;issuer&gt;                      the identity-link move of an issuer move
 * </pre>
 *
 * {@code --issuer=} overrides the issuer a link is made under (default: {@code WORKEASY360_ISSUER}). Every change is
 * audited as {@code workeasy360.operator.*}. Exit status 0 on success, 1 when refused, 2 on a usage error.
 */
public final class Workeasy360Operator {

    public static final String COMMAND = "w360sso";

    private final OrganizationLinks links;
    private final FederatedIdentities identities;
    private final OrganizationRepo orgs;
    private final AuditService audit;
    private final Workeasy360Properties properties;
    private final TransactionTemplate transactions;
    private final Clock clock;
    private final PrintStream out;

    Workeasy360Operator(OrganizationLinks links, FederatedIdentities identities, OrganizationRepo orgs, AuditService audit,
                        Workeasy360Properties properties, PlatformTransactionManager transactionManager, Clock clock,
                        PrintStream out) {
        this.links = links;
        this.identities = identities;
        this.orgs = orgs;
        this.audit = audit;
        this.properties = properties;
        this.transactions = new TransactionTemplate(transactionManager);
        this.clock = clock;
        this.out = out;
    }

    /** Starts the application without a web server, runs one command, stops it. Returns the exit status. */
    public static int run(Class<?> application, String[] args) {
        SpringApplication spring = new SpringApplication(application);
        spring.setWebApplicationType(WebApplicationType.NONE);
        spring.setBannerMode(org.springframework.boot.Banner.Mode.OFF);
        spring.setDefaultProperties(Map.of("lms.operator-mode", "true", "spring.main.log-startup-info", "false"));
        try (ConfigurableApplicationContext context = spring.run()) {
            return from(context, System.out).execute(args);
        }
    }

    public static Workeasy360Operator from(ConfigurableApplicationContext context, PrintStream out) {
        return new Workeasy360Operator(context.getBean(OrganizationLinks.class), context.getBean(FederatedIdentities.class),
                context.getBean(OrganizationRepo.class), context.getBean(AuditService.class),
                context.getBean(Workeasy360Properties.class), context.getBean(PlatformTransactionManager.class),
                context.getBean(Clock.class), out);
    }

    public int execute(String[] args) {
        if (args.length == 0) {
            return usage();
        }
        Map<String, String> options = options(args);
        try {
            return switch (args[0]) {
                case "list" -> list();
                case "link" -> link(options);
                case "unlink" -> unlink(options);
                case "move-issuer" -> moveIssuer(options);
                default -> usage();
            };
        } catch (IllegalArgumentException invalid) {
            out.println("error: " + invalid.getMessage());
            return 2;
        }
    }

    private int list() {
        Map<String, OrganizationLinks.Link> byOrg = new LinkedHashMap<>();
        for (OrganizationLinks.Link link : links.list()) {
            byOrg.put(link.orgId(), link);
        }
        out.printf("%-20s %-10s %-36s %-14s %s%n", "ORGANIZATION", "STATUS", "WORKEASY360 ORGANIZATION", "LINKED BY", "NAME");
        for (Organization org : orgs.findAll()) {
            if (Organization.PLATFORM.equals(org.getId())) {
                continue;
            }
            OrganizationLinks.Link link = byOrg.get(org.getId());
            out.printf("%-20s %-10s %-36s %-14s %s%n", org.getId(), org.getStatus(),
                    link == null ? "-" : link.workeasy360OrgId(), link == null ? "-" : link.linkedBy(), org.getName());
        }
        return 0;
    }

    private int link(Map<String, String> options) {
        UUID workeasy360Org = uuid(options.get("workeasy360-organization"));
        String orgId = required(options, "organization");
        String issuer = issuer(options);
        Optional<Organization> org = orgs.findById(orgId);
        if (org.isEmpty() || Organization.PLATFORM.equals(orgId)) {
            out.println("refused: no customer organization " + orgId);
            return 1;
        }
        Optional<OrganizationLinks.Link> existing = links.find(issuer, workeasy360Org);
        if (existing.isPresent()) {
            out.println("refused: WorkEasy360 organization " + workeasy360Org + " is already linked to " + existing.get().orgId());
            return 1;
        }
        Optional<OrganizationLinks.Link> taken = links.forOrganization(orgId);
        if (taken.isPresent()) {
            out.println("refused: " + orgId + " is already linked to WorkEasy360 organization " + taken.get().workeasy360OrgId());
            return 1;
        }
        try {
            transactions.executeWithoutResult(status -> {
                links.insert(issuer, workeasy360Org, orgId, OrganizationLinks.BY_OPERATOR, clock.instant());
                audit.record(null, orgId, "workeasy360.operator.link", "linked to WorkEasy360 organization " + workeasy360Org);
            });
        } catch (DataIntegrityViolationException raced) {
            out.println("refused: one side was linked meanwhile");
            return 1;
        }
        out.println("linked " + orgId + " (" + org.get().getName() + ") to WorkEasy360 organization " + workeasy360Org
                + " under " + issuer);
        return 0;
    }

    private int unlink(Map<String, String> options) {
        UUID workeasy360Org = uuid(options.get("workeasy360-organization"));
        String issuer = issuer(options);
        Optional<OrganizationLinks.Link> existing = links.find(issuer, workeasy360Org);
        if (existing.isEmpty()) {
            out.println("refused: WorkEasy360 organization " + workeasy360Org + " is not linked under " + issuer);
            return 1;
        }
        transactions.executeWithoutResult(status -> {
            links.unlink(issuer, workeasy360Org);
            audit.record(null, existing.get().orgId(), "workeasy360.operator.unlink",
                    "unlinked from WorkEasy360 organization " + workeasy360Org);
        });
        out.println("unlinked " + existing.get().orgId() + " from WorkEasy360 organization " + workeasy360Org);
        return 0;
    }

    private int moveIssuer(Map<String, String> options) {
        String from = required(options, "from");
        String to = required(options, "to");
        if (from.equals(to)) {
            throw new IllegalArgumentException("--from and --to are the same");
        }
        int[] moved = new int[2];
        transactions.executeWithoutResult(status -> {
            moved[0] = identities.moveIssuer(from, to);
            moved[1] = links.moveIssuer(from, to);
            audit.record(null, null, "workeasy360.operator.move_issuer",
                    "moved " + moved[0] + " identities and " + moved[1] + " organization links from " + from + " to " + to);
        });
        out.println("moved " + moved[0] + " identities and " + moved[1] + " organization links from " + from + " to " + to);
        return 0;
    }

    private String issuer(Map<String, String> options) {
        String issuer = options.getOrDefault("issuer", properties.issuer());
        if (issuer == null || issuer.isBlank()) {
            throw new IllegalArgumentException("no issuer: set WORKEASY360_ISSUER or pass --issuer=");
        }
        return issuer;
    }

    private static UUID uuid(String value) {
        if (value == null || value.length() != 36) {
            throw new IllegalArgumentException("--workeasy360-organization must be the organization's UUID");
        }
        try {
            return UUID.fromString(value.toLowerCase(java.util.Locale.ROOT));
        } catch (IllegalArgumentException invalid) {
            throw new IllegalArgumentException("--workeasy360-organization must be the organization's UUID");
        }
    }

    private static String required(Map<String, String> options, String name) {
        String value = options.get(name);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("--" + name + "= is required");
        }
        return value.strip();
    }

    private static Map<String, String> options(String[] args) {
        Map<String, String> options = new LinkedHashMap<>();
        for (String arg : List.of(args).subList(1, args.length)) {
            if (arg.startsWith("--") && arg.contains("=")) {
                options.put(arg.substring(2, arg.indexOf('=')), arg.substring(arg.indexOf('=') + 1));
            }
        }
        return options;
    }

    private int usage() {
        out.println("""
                usage: java -jar backend.jar w360sso <command>
                  list
                  link --workeasy360-organization=<uuid> --organization=<org id> [--issuer=<issuer>]
                  unlink --workeasy360-organization=<uuid> [--issuer=<issuer>]
                  move-issuer --from=<issuer> --to=<issuer>""");
        return 2;
    }
}

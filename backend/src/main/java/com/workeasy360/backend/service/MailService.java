package com.workeasy360.backend.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.stereotype.Service;

import java.util.Properties;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Outgoing e-mail over plain SMTP (SMTP_HOST/PORT/USERNAME/PASSWORD/FROM). Deliberately optional: with no
 * SMTP_HOST configured the service reports disabled() and every caller has a working no-mail path (reset links
 * handed to admins, notifications staying in-app). Sending is asynchronous and best-effort — a slow or broken
 * mail server must never block or fail the request that triggered the mail — and failures are logged without
 * the message body.
 */
@Service
public class MailService {
    private static final Logger log = LoggerFactory.getLogger(MailService.class);
    private final JavaMailSenderImpl sender; // null when SMTP is not configured
    private final String from;
    private final String publicUrl;
    private final ExecutorService executor = Executors.newSingleThreadExecutor(r -> { Thread t = new Thread(r, "mail"); t.setDaemon(true); return t; });

    public MailService(@Value("${app.mail.host:}") String host, @Value("${app.mail.port:587}") int port,
                       @Value("${app.mail.username:}") String username, @Value("${app.mail.password:}") String password,
                       @Value("${app.mail.from:}") String from, @Value("${app.mail.starttls:true}") boolean starttls,
                       @Value("${app.mail.ssl:}") String ssl, @Value("${app.public-url:}") String publicUrl) {
        this.from = !from.isBlank() ? from : username;
        this.publicUrl = publicUrl.endsWith("/") ? publicUrl.substring(0, publicUrl.length() - 1) : publicUrl;
        if (host.isBlank() || this.from.isBlank()) {
            this.sender = null;
        } else {
            // Port 465 means implicit SSL from the first byte (Hostinger, Gmail, Zoho…); 587 means STARTTLS.
            // SMTP_SSL overrides the port-based default either way.
            boolean useSsl = ssl.isBlank() ? port == 465 : Boolean.parseBoolean(ssl);
            JavaMailSenderImpl s = new JavaMailSenderImpl();
            s.setHost(host); s.setPort(port);
            if (!username.isBlank()) { s.setUsername(username); s.setPassword(password); }
            Properties p = s.getJavaMailProperties();
            p.put("mail.smtp.auth", String.valueOf(!username.isBlank()));
            p.put("mail.smtp.ssl.enable", String.valueOf(useSsl));
            p.put("mail.smtp.starttls.enable", String.valueOf(!useSsl && starttls));
            p.put("mail.smtp.connectiontimeout", "10000");
            p.put("mail.smtp.timeout", "10000");
            p.put("mail.smtp.writetimeout", "10000");
            this.sender = s;
            log.info("Outgoing e-mail enabled via {}:{} ({}, from {})", host, port, useSsl ? "SSL" : starttls ? "STARTTLS" : "plain", this.from);
        }
    }

    public boolean enabled() { return sender != null; }

    /** The absolute base for links in e-mails (APP_PUBLIC_URL), or "" when none is configured. */
    public String publicUrl() { return publicUrl; }

    /** Queues one plain-text e-mail; never throws, never blocks the caller. */
    public void send(String to, String subject, String body) {
        if (sender == null || to == null || to.isBlank()) return;
        executor.submit(() -> {
            try {
                SimpleMailMessage m = new SimpleMailMessage();
                m.setFrom(from); m.setTo(to); m.setSubject(subject); m.setText(body);
                sender.send(m);
            } catch (Exception e) {
                log.warn("Could not send e-mail to {} ({}): {}", to, subject, e.getMessage());
            }
        });
    }
}

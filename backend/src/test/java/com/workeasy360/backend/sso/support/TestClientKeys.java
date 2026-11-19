package com.workeasy360.backend.sso.support;

import com.nimbusds.jose.jwk.Curve;
import com.nimbusds.jose.jwk.ECKey;
import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.ECKeyGenerator;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;

/**
 * The product's own credential for tests: a key pair per algorithm, the PEM on disk (as an operator would
 * mount it) and the public half registered with the {@link FakeWorkeasy360}.
 */
public final class TestClientKeys {

    public static final String RSA_KEY_ID = "client-rsa-1";
    public static final String EC_KEY_ID = "client-ec-1";

    public static final RSAKey RSA;
    public static final ECKey EC;
    public static final Path RSA_FILE;
    public static final Path EC_FILE;

    static {
        try {
            RSA = new RSAKeyGenerator(2048).keyID(RSA_KEY_ID).generate();
            EC = new ECKeyGenerator(Curve.P_256).keyID(EC_KEY_ID).generate();
            RSA_FILE = write("rsa", pem("PRIVATE KEY", RSA.toRSAPrivateKey().getEncoded()));
            EC_FILE = write("ec", pem("PRIVATE KEY", EC.toECPrivateKey().getEncoded()));
        } catch (Exception exception) {
            throw new ExceptionInInitializerError(exception);
        }
        FakeWorkeasy360.shared().registerClientKey(RSA);
        FakeWorkeasy360.shared().registerClientKey(EC);
    }

    private TestClientKeys() {
    }

    public static JWK jwk(boolean ec) {
        return ec ? EC : RSA;
    }

    public static String pem(String label, byte[] der) {
        String body = Base64.getMimeEncoder(64, "\n".getBytes()).encodeToString(der);
        return "-----BEGIN " + label + "-----\n" + body + "\n-----END " + label + "-----\n";
    }

    private static Path write(String name, String content) throws IOException {
        Path file = Files.createTempFile("workeasy-lms-test-" + name, ".pem");
        file.toFile().deleteOnExit();
        Files.writeString(file, content);
        return file;
    }
}

package com.workeasy360.backend.sso.oidc;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.Curve;
import com.nimbusds.jose.jwk.ECKey;
import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.KeyUse;
import com.nimbusds.jose.jwk.RSAKey;
import java.io.ByteArrayOutputStream;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.AlgorithmParameters;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.security.interfaces.RSAPrivateCrtKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.ECFieldFp;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.ECParameterSpec;
import java.security.spec.ECPoint;
import java.security.spec.ECPublicKeySpec;
import java.security.spec.InvalidKeySpecException;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.RSAPublicKeySpec;
import java.util.Base64;

/**
 * Loads this product's private key (the credential registered in Workeasy360 as a public key) and
 * turns it into the JWK that signs {@code private_key_jwt} client assertions.
 *
 * <p>Accepts RSA (at least 2048 bits, signed RS256) and EC P-256 (ES256) keys in the PEM forms
 * {@code openssl} produces: PKCS#8 ({@code BEGIN PRIVATE KEY}), PKCS#1 ({@code BEGIN RSA PRIVATE
 * KEY}) and SEC1 ({@code BEGIN EC PRIVATE KEY}). The algorithm follows the key, so the two can never
 * disagree. The key itself is never logged and never appears in an exception message.
 */
public final class ClientKey {

    /** The two characters backslash and n, as they arrive in a one-line environment variable. */
    private static final String ESCAPED_NEWLINE = "\\" + "n";

    private ClientKey() {
    }

    /** The PEM text from a file, or from the variable with literal backslash-n sequences restored. */
    public static String readPem(String file, String inline) {
        if (file != null && !file.isBlank()) {
            try {
                return Files.readString(Path.of(file.trim()), StandardCharsets.UTF_8);
            } catch (java.io.IOException | RuntimeException exception) {
                throw new IllegalArgumentException("The private key file cannot be read.");
            }
        }
        if (inline == null || inline.isBlank()) {
            throw new IllegalArgumentException("No private key is configured.");
        }
        return inline.replace(ESCAPED_NEWLINE, "\n");
    }

    /**
     * @throws IllegalArgumentException with a message that never contains key material
     */
    public static JWK parse(String pem, String keyId) {
        if (keyId == null || keyId.isBlank()) {
            throw new IllegalArgumentException("No key id is configured.");
        }
        try {
            return parseUnchecked(pem, keyId.trim());
        } catch (IllegalArgumentException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new IllegalArgumentException("The private key is not a usable RSA or EC P-256 key.");
        }
    }

    private static JWK parseUnchecked(String pem, String keyId) throws Exception {
        String label = label(pem);
        byte[] der = body(pem, label);
        byte[] pkcs8 = switch (label) {
            case "PRIVATE KEY" -> der;
            case "RSA PRIVATE KEY" -> wrapPkcs8(der, RSA_ALGORITHM);
            case "EC PRIVATE KEY" -> wrapPkcs8(der, EC_P256_ALGORITHM);
            default -> throw new IllegalArgumentException(
                    "The private key must be an unencrypted PEM (BEGIN PRIVATE KEY).");
        };
        PKCS8EncodedKeySpec spec = new PKCS8EncodedKeySpec(pkcs8);
        PrivateKey privateKey;
        try {
            privateKey = KeyFactory.getInstance("RSA").generatePrivate(spec);
        } catch (InvalidKeySpecException notRsa) {
            privateKey = KeyFactory.getInstance("EC").generatePrivate(spec);
        }
        if (privateKey instanceof RSAPrivateCrtKey rsa) {
            return rsaJwk(rsa, keyId);
        }
        if (privateKey instanceof ECPrivateKey ec) {
            return ecJwk(ec, keyId);
        }
        throw new IllegalArgumentException("The private key must be RSA or EC P-256.");
    }

    private static JWK rsaJwk(RSAPrivateCrtKey key, String keyId) throws Exception {
        if (key.getModulus().bitLength() < 2048) {
            throw new IllegalArgumentException("The RSA private key must be at least 2048 bits.");
        }
        RSAPublicKey publicKey = (RSAPublicKey) KeyFactory.getInstance("RSA")
                .generatePublic(new RSAPublicKeySpec(key.getModulus(), key.getPublicExponent()));
        return new RSAKey.Builder(publicKey).privateKey(key).keyID(keyId).keyUse(KeyUse.SIGNATURE)
                .algorithm(JWSAlgorithm.RS256).build();
    }

    private static JWK ecJwk(ECPrivateKey key, String keyId) throws Exception {
        ECParameterSpec p256 = p256();
        if (!key.getParams().getCurve().equals(p256.getCurve())
                || !key.getParams().getGenerator().equals(p256.getGenerator())) {
            throw new IllegalArgumentException("The EC private key must use the P-256 curve.");
        }
        ECPoint q = multiply(p256, key.getS());
        ECPublicKey publicKey = (ECPublicKey) KeyFactory.getInstance("EC")
                .generatePublic(new ECPublicKeySpec(q, p256));
        return new ECKey.Builder(Curve.P_256, publicKey).privateKey(key).keyID(keyId).keyUse(KeyUse.SIGNATURE)
                .algorithm(JWSAlgorithm.ES256).build();
    }

    // --- PEM -----------------------------------------------------------------

    private static String label(String pem) {
        String text = pem == null ? "" : pem;
        int begin = text.indexOf("-----BEGIN ");
        int end = begin < 0 ? -1 : text.indexOf("-----", begin + 11);
        if (begin < 0 || end < 0) {
            throw new IllegalArgumentException("The private key is not PEM encoded.");
        }
        return text.substring(begin + 11, end).trim();
    }

    private static byte[] body(String pem, String label) {
        String begin = "-----BEGIN " + label + "-----";
        String end = "-----END " + label + "-----";
        int from = pem.indexOf(begin) + begin.length();
        int to = pem.indexOf(end);
        if (to < from) {
            throw new IllegalArgumentException("The private key is not PEM encoded.");
        }
        return Base64.getMimeDecoder().decode(pem.substring(from, to));
    }

    // --- DER wrapping of the two legacy forms ------------------------------------

    /** AlgorithmIdentifier { rsaEncryption, NULL }. */
    private static final byte[] RSA_ALGORITHM = der(0x30,
            concat(new byte[] {0x06, 0x09, 0x2a, (byte) 0x86, 0x48, (byte) 0x86, (byte) 0xf7, 0x0d, 0x01, 0x01, 0x01},
                    new byte[] {0x05, 0x00}));

    /** AlgorithmIdentifier { id-ecPublicKey, prime256v1 }. */
    private static final byte[] EC_P256_ALGORITHM = der(0x30,
            concat(new byte[] {0x06, 0x07, 0x2a, (byte) 0x86, 0x48, (byte) 0xce, 0x3d, 0x02, 0x01},
                    new byte[] {0x06, 0x08, 0x2a, (byte) 0x86, 0x48, (byte) 0xce, 0x3d, 0x03, 0x01, 0x07}));

    private static byte[] wrapPkcs8(byte[] inner, byte[] algorithm) {
        return der(0x30, concat(new byte[] {0x02, 0x01, 0x00}, algorithm, der(0x04, inner)));
    }

    private static byte[] der(int tag, byte[] content) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(tag);
        if (content.length < 0x80) {
            out.write(content.length);
        } else if (content.length < 0x100) {
            out.write(0x81);
            out.write(content.length);
        } else if (content.length < 0x10000) {
            out.write(0x82);
            out.write(content.length >> 8);
            out.write(content.length & 0xff);
        } else {
            out.write(0x83);
            out.write(content.length >> 16);
            out.write((content.length >> 8) & 0xff);
            out.write(content.length & 0xff);
        }
        out.writeBytes(content);
        return out.toByteArray();
    }

    private static byte[] concat(byte[]... parts) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (byte[] part : parts) {
            out.writeBytes(part);
        }
        return out.toByteArray();
    }

    // --- P-256 public point from the private scalar ---------------------------------
    //
    // A PKCS#8 / SEC1 file always has the scalar but only sometimes the public point, and the JDK has no
    // public API for scalar multiplication. This runs once at start-up, so plain affine double-and-add is
    // fast enough and keeps the dependency list as it was.

    private static ECParameterSpec p256() throws Exception {
        AlgorithmParameters parameters = AlgorithmParameters.getInstance("EC");
        parameters.init(new ECGenParameterSpec("secp256r1"));
        return parameters.getParameterSpec(ECParameterSpec.class);
    }

    static ECPoint multiply(ECParameterSpec spec, BigInteger scalar) {
        BigInteger p = ((ECFieldFp) spec.getCurve().getField()).getP();
        BigInteger a = spec.getCurve().getA();
        ECPoint result = ECPoint.POINT_INFINITY;
        ECPoint addend = spec.getGenerator();
        for (int bit = 0; bit < scalar.bitLength(); bit++) {
            if (scalar.testBit(bit)) {
                result = add(result, addend, p, a);
            }
            addend = add(addend, addend, p, a);
        }
        return result;
    }

    private static ECPoint add(ECPoint left, ECPoint right, BigInteger p, BigInteger a) {
        if (left.equals(ECPoint.POINT_INFINITY)) {
            return right;
        }
        if (right.equals(ECPoint.POINT_INFINITY)) {
            return left;
        }
        BigInteger slope;
        if (left.getAffineX().equals(right.getAffineX())) {
            if (!left.getAffineY().equals(right.getAffineY()) || left.getAffineY().signum() == 0) {
                return ECPoint.POINT_INFINITY;
            }
            slope = left.getAffineX().pow(2).multiply(BigInteger.valueOf(3)).add(a)
                    .multiply(left.getAffineY().shiftLeft(1).modInverse(p)).mod(p);
        } else {
            slope = right.getAffineY().subtract(left.getAffineY())
                    .multiply(right.getAffineX().subtract(left.getAffineX()).modInverse(p)).mod(p);
        }
        BigInteger x = slope.pow(2).subtract(left.getAffineX()).subtract(right.getAffineX()).mod(p);
        BigInteger y = slope.multiply(left.getAffineX().subtract(x)).subtract(left.getAffineY()).mod(p);
        return new ECPoint(x, y);
    }
}

package com.workeasy360.backend.domain;

import java.security.SecureRandom;

/** Short, readable, app-generated IDs (mirrors the frontend's uid("prefix") scheme). */
public final class Ids {
    private static final String ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
    private static final SecureRandom RNG = new SecureRandom();
    private Ids() {}

    public static String next(String prefix) {
        StringBuilder sb = new StringBuilder(prefix).append('-');
        for (int i = 0; i < 12; i++) sb.append(ALPHABET.charAt(RNG.nextInt(ALPHABET.length())));
        return sb.toString();
    }
}

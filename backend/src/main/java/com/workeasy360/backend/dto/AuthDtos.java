package com.workeasy360.backend.dto;

import com.workeasy360.backend.domain.User;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

public class AuthDtos {
    public record LoginRequest(@NotBlank @Email String email, @NotBlank String password) {}
    public record LoginResponse(String token, UserDto user) {}

    public record UserDto(String id, String name, String email, String role, String title, String dept, Integer hue, Integer streak, String status) {
        public static UserDto of(User u) {
            return new UserDto(u.getId(), u.getName(), u.getEmail(), u.getRole().name(), u.getTitle(), u.getDept(), u.getHue(), u.getStreak(),
                    u.getStatus() == null ? "ACTIVE" : u.getStatus());
        }
    }
}

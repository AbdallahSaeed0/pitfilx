import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Email/password-style input used on Login, Sign Up, and Edit Profile.
class AuthTextField extends StatelessWidget {
  final TextEditingController controller;
  final bool obscureText;
  final String? hintText;

  const AuthTextField({
    super.key,
    required this.controller,
    this.obscureText = false,
    this.hintText,
  });

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      obscureText: obscureText,
      style: AppTextStyles.dmSans(
        fontSize: 15,
        color: obscureText ? AppColors.inputTextObscured : AppColors.inputText,
        letterSpacing: obscureText ? 15 * 0.28 : null,
      ),
      decoration: InputDecoration(
        filled: true,
        fillColor: AppColors.bgCard,
        hintText: hintText,
        hintStyle: AppTextStyles.dmSans(
          fontSize: 15,
          color: AppColors.textMuted,
        ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 14,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(
            color: AppColors.borderInput,
            width: 1.5,
          ),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(
            color: AppColors.borderInput,
            width: 1.5,
          ),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: AppColors.accent, width: 1.5),
        ),
      ),
    );
  }
}

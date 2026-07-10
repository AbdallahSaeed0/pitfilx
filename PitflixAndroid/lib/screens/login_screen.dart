import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../services/auth_service.dart';
import '../services/friends_store.dart';
import '../theme/app_theme.dart';
import '../widgets/widgets.dart';
import 'root_shell.dart';
import 'sign_up_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _loading = false;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _logIn() async {
    final input = _emailController.text.trim();
    final password = _passwordController.text;
    if (input.isEmpty || password.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter your email/username and password')),
      );
      return;
    }
    setState(() => _loading = true);
    try {
      String email;
      if (input.contains('@')) {
        email = input;
      } else {
        final resolved = await AuthService.emailForUsername(input);
        if (resolved == null) {
          if (!mounted) return;
          setState(() => _loading = false);
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('No account found for "$input"')),
          );
          return;
        }
        email = resolved;
      }
      await AuthService.signIn(email, password);
      await FriendsStore.refresh();
      if (!mounted) return;
      Navigator.of(
        context,
      ).pushReplacement(MaterialPageRoute(builder: (_) => const RootShell()));
    } on AuthException catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    } catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text("Couldn't log in: $e")));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bgBase,
      body: PosterWallBackground(
        child: SafeArea(
          child: LayoutBuilder(
            builder: (context, constraints) => SingleChildScrollView(
              child: ConstrainedBox(
                constraints: BoxConstraints(minHeight: constraints.maxHeight),
                child: IntrinsicHeight(child: _buildContent(context)),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildContent(BuildContext context) {
    return Column(
      children: [
        Expanded(
          child: Center(
            child: FittedBox(
              fit: BoxFit.scaleDown,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 80,
                    height: 80,
                    decoration: BoxDecoration(
                      color: AppColors.logoAccentDim,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      'P',
                      style: AppTextStyles.bebas(
                        fontSize: 40,
                        color: AppColors.textPrimary,
                      ),
                    ),
                  ),
                  const SizedBox(height: 24),
                  const AnimatedWordmark(fontSize: 52, loop: true),
                ],
              ),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(32, 0, 32, 52),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('EMAIL OR USERNAME', style: AppTextStyles.sectionLabel()),
              const SizedBox(height: 8),
              AuthTextField(controller: _emailController),
              const SizedBox(height: 14),
              Text('PASSWORD', style: AppTextStyles.sectionLabel()),
              const SizedBox(height: 8),
              AuthTextField(controller: _passwordController, obscureText: true),
              const SizedBox(height: 28),
              ElevatedButton(
                onPressed: _loading ? null : _logIn,
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.buttonPurple,
                  foregroundColor: AppColors.textPrimary,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  elevation: 0,
                ),
                child: _loading
                    ? const SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.4,
                          color: AppColors.textPrimary,
                        ),
                      )
                    : Text(
                        'LOG IN',
                        style: AppTextStyles.bebas(
                          fontSize: 22,
                          color: AppColors.textPrimary,
                          letterSpacing: 0.14,
                        ),
                      ),
              ),
              const SizedBox(height: 16),
              Center(
                child: Text(
                  'Forgot password?',
                  style: AppTextStyles.dmSans(
                    fontSize: 13,
                    color: Colors.white.withValues(alpha: 0.45),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Center(
                child: GestureDetector(
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const SignUpScreen()),
                  ),
                  child: RichText(
                    text: TextSpan(
                      style: AppTextStyles.dmSans(
                        fontSize: 13,
                        color: Colors.white.withValues(alpha: 0.45),
                      ),
                      children: [
                        const TextSpan(text: "Don't have an account? "),
                        TextSpan(
                          text: 'Sign Up',
                          style: AppTextStyles.dmSans(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: AppColors.accent,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

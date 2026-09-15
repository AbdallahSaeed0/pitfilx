import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../services/auth_service.dart';
import '../services/friends_store.dart';
import '../services/social_service.dart';
import '../theme/app_theme.dart';
import '../widgets/widgets.dart';
import 'onboarding_screen.dart';

class SignUpScreen extends StatefulWidget {
  const SignUpScreen({super.key});

  @override
  State<SignUpScreen> createState() => _SignUpScreenState();
}

class _SignUpScreenState extends State<SignUpScreen> {
  final _usernameController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  bool _loading = false;

  @override
  void dispose() {
    _usernameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  static final _usernamePattern = RegExp(r'^[a-zA-Z0-9_.]{3,20}$');

  Future<void> _signUp() async {
    final username = _usernameController.text.trim();
    final email = _emailController.text.trim();
    final password = _passwordController.text;
    if (!_usernamePattern.hasMatch(username)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Username must be 3-20 characters: letters, numbers, "_" or "."',
          ),
        ),
      );
      return;
    }
    if (email.isEmpty || !email.contains('@') || password.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter a valid email and password')),
      );
      return;
    }
    if (password != _confirmPasswordController.text) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Passwords don’t match')));
      return;
    }
    setState(() => _loading = true);
    try {
      // Checked up front (rather than only relying on the DB's unique
      // constraint after the fact) so a taken username never leaves behind
      // a signed-up auth account with no username set — the RPC email
      // lookup already exists for Login's username-or-email field, and
      // doubles as an availability check here (a hit means it's taken).
      final existingEmail = await AuthService.emailForUsername(username);
      if (existingEmail != null) {
        if (!mounted) return;
        setState(() => _loading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('That username is already taken')),
        );
        return;
      }

      final response = await AuthService.signUp(email, password);
      if (!mounted) return;
      if (response.session != null) {
        // Email confirmation disabled — Supabase returned a session
        // immediately, so log straight into the app.
        try {
          await SocialService.updateProfile(username: username);
        } catch (_) {
          // Rare race (someone else took the name in the last few seconds)
          // — the account still exists and works, just without a username
          // set; Edit Profile lets them pick another one later.
        }
        await FriendsStore.refresh();
        if (!mounted) return;
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const OnboardingScreen()),
        );
      } else {
        // Defensive path in case email confirmation gets re-enabled later.
        setState(() => _loading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Check your email to confirm your account'),
          ),
        );
        Navigator.of(context).pop();
      }
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
      ).showSnackBar(SnackBar(content: Text("Couldn't sign up: $e")));
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
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 14, 20, 0),
          child: Row(
            children: [
              CircleIconButton(
                icon: Icons.arrow_back_ios_new,
                background: AppColors.bgCard,
                onTap: () => Navigator.of(context).pop(),
              ),
            ],
          ),
        ),
        Expanded(
          child: Center(
            child: FittedBox(
              fit: BoxFit.scaleDown,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 64,
                    height: 64,
                    decoration: BoxDecoration(
                      color: AppColors.logoAccentDim,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      'P',
                      style: AppTextStyles.bebas(
                        fontSize: 32,
                        color: AppColors.textPrimary,
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'CREATE ACCOUNT',
                    style: AppTextStyles.bebas(
                      fontSize: 26,
                      letterSpacing: 0.1,
                    ),
                  ),
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
              Text('USERNAME', style: AppTextStyles.sectionLabel()),
              const SizedBox(height: 8),
              AuthTextField(
                controller: _usernameController,
                hintText: 'User Name',
              ),
              const SizedBox(height: 14),
              Text('EMAIL', style: AppTextStyles.sectionLabel()),
              const SizedBox(height: 8),
              AuthTextField(
                controller: _emailController,
                hintText: 'you@example.com',
              ),
              const SizedBox(height: 14),
              Text('PASSWORD', style: AppTextStyles.sectionLabel()),
              const SizedBox(height: 8),
              AuthTextField(controller: _passwordController, obscureText: true),
              const SizedBox(height: 14),
              Text('CONFIRM PASSWORD', style: AppTextStyles.sectionLabel()),
              const SizedBox(height: 8),
              AuthTextField(
                controller: _confirmPasswordController,
                obscureText: true,
              ),
              const SizedBox(height: 28),
              ElevatedButton(
                onPressed: _loading ? null : _signUp,
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
                        'SIGN UP',
                        style: AppTextStyles.bebas(
                          fontSize: 22,
                          color: AppColors.textPrimary,
                          letterSpacing: 0.14,
                        ),
                      ),
              ),
              const SizedBox(height: 16),
              Center(
                child: GestureDetector(
                  onTap: () => Navigator.of(context).pop(),
                  child: RichText(
                    text: TextSpan(
                      style: AppTextStyles.dmSans(
                        fontSize: 13,
                        color: Colors.white.withValues(alpha: 0.45),
                      ),
                      children: [
                        const TextSpan(text: 'Already have an account? '),
                        TextSpan(
                          text: 'Log In',
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

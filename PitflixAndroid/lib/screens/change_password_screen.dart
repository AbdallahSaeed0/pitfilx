import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';
import '../widgets/widgets.dart';

class ChangePasswordScreen extends StatefulWidget {
  const ChangePasswordScreen({super.key});

  @override
  State<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends State<ChangePasswordScreen> {
  final _currentController = TextEditingController();
  final _newController = TextEditingController();
  final _confirmController = TextEditingController();
  bool _loading = false;

  @override
  void dispose() {
    _currentController.dispose();
    _newController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final current = _currentController.text;
    final next = _newController.text;
    final confirm = _confirmController.text;

    if (current.isEmpty || next.isEmpty || confirm.isEmpty) {
      _showMessage('Fill in all fields');
      return;
    }
    if (next.length < 6) {
      _showMessage('New password must be at least 6 characters');
      return;
    }
    if (next != confirm) {
      _showMessage("New passwords don't match");
      return;
    }

    setState(() => _loading = true);
    try {
      await AuthService.changePassword(
        currentPassword: current,
        newPassword: next,
      );
      if (!mounted) return;
      Navigator.of(context).pop();
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Password updated')));
    } on AuthException catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
      _showMessage(e.message);
    } catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
      _showMessage("Couldn't update password: $e");
    }
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bgBase,
      body: SafeArea(
        child: Column(
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
                  const SizedBox(width: 14),
                  Text(
                    'CHANGE PASSWORD',
                    style: AppTextStyles.bebas(
                      fontSize: 22,
                      letterSpacing: 0.1,
                      color: AppColors.logoAccent,
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(20, 24, 20, 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text('CURRENT PASSWORD', style: AppTextStyles.sectionLabel()),
                    const SizedBox(height: 8),
                    AuthTextField(
                      controller: _currentController,
                      obscureText: true,
                    ),
                    const SizedBox(height: 18),
                    Text('NEW PASSWORD', style: AppTextStyles.sectionLabel()),
                    const SizedBox(height: 8),
                    AuthTextField(controller: _newController, obscureText: true),
                    const SizedBox(height: 18),
                    Text('CONFIRM NEW PASSWORD', style: AppTextStyles.sectionLabel()),
                    const SizedBox(height: 8),
                    AuthTextField(
                      controller: _confirmController,
                      obscureText: true,
                    ),
                    const SizedBox(height: 28),
                    ElevatedButton(
                      onPressed: _loading ? null : _submit,
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
                              'UPDATE PASSWORD',
                              style: AppTextStyles.bebas(
                                fontSize: 18,
                                color: AppColors.textPrimary,
                                letterSpacing: 0.1,
                              ),
                            ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

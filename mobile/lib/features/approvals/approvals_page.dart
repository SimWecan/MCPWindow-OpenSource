import 'package:flutter/material.dart';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/app_theme.dart';
import '../../core/strings.dart';
import '../../core/time_text.dart';
import '../../models/approval.dart';
import '../../state/mobile_controller.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/gradient_button.dart';
import '../../widgets/tf_icon_tile.dart';
import '../../widgets/tf_page.dart';
import '../overview/overview_page.dart';

class ApprovalsPage extends ConsumerWidget {
  const ApprovalsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(mobileControllerProvider);
    return TfPage(
      appBar: AppBar(title: Text(tr(context, '审批'))),
      body: state.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => ErrorBody(message: error.toString()),
        data: (snapshot) {
          final approvals = snapshot.approvals;
          if (approvals.isEmpty) {
            return EmptyState(
              icon: Icons.verified_user_outlined,
              title: tr(context, '暂无审批请求'),
              message: tr(context, '桌面端发起高风险操作时会在这里等待确认。'),
            );
          }
          return RefreshIndicator(
            onRefresh: () =>
                ref.read(mobileControllerProvider.notifier).refresh(),
            child: ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
              itemCount: approvals.length,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (context, index) {
                final approval = approvals[index];
                final en = isEnOf(context);
                return Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            TfIconTile(
                              icon: Icons.verified_user_outlined,
                              color: approval.status == ApprovalStatus.pending
                                  ? TfColors.warning
                                  : approval.status == ApprovalStatus.approved
                                  ? TfColors.success
                                  : TfColors.danger,
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Text(
                                '${approval.serverName} · ${actionLabel(approval.action, en)}',
                                style: Theme.of(context).textTheme.titleMedium
                                    ?.copyWith(fontWeight: FontWeight.w700),
                              ),
                            ),
                            _ApprovalStatusChip(status: approval.status),
                          ],
                        ),
                        const SizedBox(height: 12),
                        Text(approval.reason),
                        const SizedBox(height: 8),
                        Text(
                          '${approval.requestedBy} · ${relativeTime(approval.createdAt, en: en)}',
                          style: Theme.of(context).textTheme.bodySmall
                              ?.copyWith(
                                color: Theme.of(context)
                                    .colorScheme
                                    .onSurfaceVariant,
                              ),
                        ),
                        if (approval.status == ApprovalStatus.pending) ...[
                          const SizedBox(height: 16),
                          Row(
                            children: [
                              Expanded(
                                child: OutlinedButton(
                                  onPressed: () =>
                                      _respond(context, ref, approval, false),
                                  child: Text(tr(context, '拒绝')),
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: GradientButton(
                                  onPressed: () =>
                                      _respond(context, ref, approval, true),
                                  label: tr(context, '批准'),
                                  icon: Icons.check,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                );
              },
            ),
          );
        },
      ),
    );
  }

  Future<void> _respond(
    BuildContext context,
    WidgetRef ref,
    ApprovalItem approval,
    bool approved,
  ) async {
    final en = isEnOf(context);
    final action = actionLabel(approval.action, en);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        icon: Icon(
          approved ? Icons.check_circle_outline : Icons.cancel_outlined,
        ),
        title: Text(tr(context, approved ? '批准操作' : '拒绝操作')),
        content: Text(
          tr(
            context,
            approved ? '将批准对“{name}”的{action}请求。' : '将拒绝对“{name}”的{action}请求。',
            {'name': approval.serverName, 'action': action},
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(tr(context, '取消')),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(tr(context, '确认')),
          ),
        ],
      ),
    );
    if (confirmed ?? false) {
      await ref
          .read(mobileControllerProvider.notifier)
          .respondToApproval(approval.id, approved);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(tr(context, approved ? '已批准' : '已拒绝')),
          ),
        );
      }
    }
  }
}

class _ApprovalStatusChip extends StatelessWidget {
  const _ApprovalStatusChip({required this.status});

  final ApprovalStatus status;

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (status) {
      ApprovalStatus.pending => (
        tr(context, '待审批'),
        TfColors.warning,
      ),
      ApprovalStatus.approved => (tr(context, '已批准'), TfColors.success),
      ApprovalStatus.rejected => (tr(context, '已拒绝'), TfColors.danger),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Text(
        label,
        style: TextStyle(color: color, fontWeight: FontWeight.w600),
      ),
    );
  }
}

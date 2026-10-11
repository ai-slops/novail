import { AlertTriangle, Bot, Check, ChevronRight, FilePenLine, GitPullRequest, ShieldCheck, X } from "lucide-react"
import { useState } from "react"
import type { Candidate } from "../types"
import type { ChangeEntry, ChangeSet } from "../../packages/revision/contracts"
import { deriveChangeSet, mutate, promoteCandidate } from "../api"
import { RevisionComposer } from "./RevisionComposer"
import { EvaluationWorkspace } from "./EvaluationWorkspace"

type Props = Readonly<{ changeSets: readonly ChangeSet[]; candidates: readonly Candidate[]; branchId: string; head: string; busy: boolean; onRefresh: () => Promise<void>; onDirtyChange: (dirty: boolean) => void; onBeforeDiscard: () => boolean; onScene: (id: string) => void }>

export function RevisionWorkspace(props: Props) {
  const [selectedId, setSelectedId] = useState(props.changeSets.at(-1)?.id ?? "")
  const [composer, setComposer] = useState<"manual" | "repair" | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selected = props.changeSets.find((item) => item.id === selectedId) ?? props.changeSets.at(-1)
  const act = async (action: () => Promise<void>): Promise<boolean> => { setWorking(true); setError(null); try { await action(); await props.onRefresh(); return true } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : "요청을 완료하지 못했습니다."); return false } finally { setWorking(false) } }
  const selectProposal = (id: string) => {
    if (id === selected?.id || !props.onBeforeDiscard()) return
    setSelectedId(id)
    props.onDirtyChange(false)
  }
  const openComposer = (mode: "manual" | "repair") => { if (props.onBeforeDiscard()) setComposer(mode) }
  return <main className="secondary-view revision-workspace" id="main-content">
    <header className="view-header"><div><p className="overline">HUMAN-IN-THE-LOOP V2</p><h2>개정 검토</h2><p className="view-description">기계적 검증과 사람의 서사 판단은 서로 다릅니다. 영향 대상을 확인한 뒤에만 기준본을 바꿀 수 있습니다.</p></div>
      <div className="toolbar-actions"><button className="button quiet" type="button" disabled={props.busy || working} onClick={() => openComposer("manual")}><FilePenLine /> 수동 제안</button><button className="button primary" type="button" disabled={props.busy || working} onClick={() => openComposer("repair")}><Bot /> AI 수정 제안</button></div></header>
    <div className="revision-layout"><ProposalRail changeSets={props.changeSets} selectedId={selected?.id ?? ""} onSelect={selectProposal} />
      {selected ? <ProposalReview key={`${props.branchId}:${selected.id}`} changeSet={selected} branchId={props.branchId} busy={props.busy || working} error={error}
        onDirtyChange={props.onDirtyChange} onBeforeDiscard={props.onBeforeDiscard}
        onDerive={async (ids) => { if (!props.onBeforeDiscard()) return; let childId = ""; const succeeded = await act(async () => { childId = (await deriveChangeSet(selected.id, ids, props.branchId)).id }); if (succeeded) { setSelectedId(childId); props.onDirtyChange(false) } }}
        onCommit={async (reviewedKeys) => { await act(() => mutate(`api/change-sets/${selected.id}/commit`, { expectedHead: props.head, approvedHash: selected.hash, reviewedKeys, decision: "accept", policyVersion: 2 }, props.branchId)) }}
        onReject={async () => { await act(() => mutate(`api/change-sets/${selected.id}/reject`, { decision: "reject" }, props.branchId)) }} /> : <EmptyReview />}
    </div>
    {error && !selected ? <p className="dialog-error" role="alert">{error}</p> : null}
    <LegacyCandidates candidates={props.candidates} busy={props.busy || working} onScene={props.onScene}
      onReject={async (candidate) => { await act(() => mutate(`api/candidates/${candidate.id}/reject`, {}, props.branchId)) }}
      onPromote={async (candidate) => { if (!props.onBeforeDiscard()) return; let createdId = ""; const succeeded = await act(async () => { createdId = (await promoteCandidate(candidate.id, props.head, props.branchId)).id }); if (succeeded) { setSelectedId(createdId); props.onDirtyChange(false) } }} />
    {composer ? <RevisionComposer mode={composer} branchId={props.branchId} onClose={() => setComposer(null)} onCreated={async (id) => { await props.onRefresh(); if (id) { setSelectedId(id); props.onDirtyChange(false) } }} /> : null}
  </main>
}

function ProposalRail({ changeSets, selectedId, onSelect }: Readonly<{ changeSets: readonly ChangeSet[]; selectedId: string; onSelect: (id: string) => void }>) {
  return <nav className="proposal-rail" aria-label="V2 변경 제안 목록"><header><strong>V2 변경 제안</strong><span>{changeSets.length}</span></header>{changeSets.toReversed().map((item) => <button type="button" key={item.id} className={selectedId === item.id ? "active" : ""} onClick={() => onSelect(item.id)}><span className={`revision-state ${item.status}`}><GitPullRequest /> {statusLabel(item.status)}</span><strong>{item.reason}</strong><small>{item.entries.length}개 변경 · {item.bundles.length}개 묶음</small></button>)}</nav>
}

const statusLabels: Readonly<Record<string, string>> = { pending: "검토 대기", committed: "채택 완료", stale_candidate: "기준본 변경됨", rejected: "거절됨", cancelled: "취소됨", partially_applied: "부분 채택됨" }
const statusLabel = (status: string): string => statusLabels[status] ?? status

function ProposalReview({ changeSet, branchId, busy, error, onDirtyChange, onBeforeDiscard, onDerive, onCommit, onReject }: Readonly<{ changeSet: ChangeSet; branchId: string; busy: boolean; error: string | null; onDirtyChange: (dirty: boolean) => void; onBeforeDiscard: () => boolean; onDerive: (ids: readonly string[]) => Promise<void>; onCommit: (keys: readonly string[]) => Promise<void>; onReject: () => Promise<void> }>) {
  const [selectedBundles, setSelectedBundles] = useState<readonly string[]>(changeSet.bundles.map((bundle) => bundle.id))
  const [reviewed, setReviewed] = useState<readonly string[]>([])
  const selectedChanges = changeSet.bundles.filter((bundle) => selectedBundles.includes(bundle.id)).flatMap((bundle) => bundle.changeIds)
  const allSelected = selectedBundles.length === changeSet.bundles.length
  const canSelectBundles = changeSet.parentChangeSetId === null && changeSet.kind !== "merge" && changeSet.bundles.length > 1
  const acknowledged = changeSet.requiredReviewKeys.every((key) => reviewed.includes(key))
  const blocked = !changeSet.canCommit || changeSet.issues.length > 0 || changeSet.impact.incomplete || !acknowledged
  return <section className="proposal-review">
    <header><div><span className="revision-state"><ShieldCheck /> {changeSet.kind}</span><h3>{changeSet.reason}</h3></div><code title={changeSet.hash}>{changeSet.hash}</code></header>
    <section className="review-callout"><strong>검토 ≠ 재작성</strong><p>영향 검토 목록은 확인해야 할 범위이며, 모델이 자동으로 다시 쓰는 범위가 아닙니다. 변경하지 않는 영향 대상은 반드시 확인하세요.</p></section>
    {canSelectBundles ? <fieldset className="bundle-list"><legend>부분 채택 묶음</legend>{changeSet.bundles.map((bundle) => <label key={bundle.id}><input type="checkbox" disabled={busy || changeSet.status !== "pending"} checked={selectedBundles.includes(bundle.id)} onChange={() => setSelectedBundles((current) => current.includes(bundle.id) ? current.filter((id) => id !== bundle.id) : [...current, bundle.id])} /><span><strong>{bundle.label}</strong><small>{bundle.changeIds.length}개 변경 · 완전한 묶음 단위</small></span></label>)}</fieldset> : null}
    <div className="artifact-diffs">{changeSet.entries.map((entry) => <EntryDiff key={entry.id} entry={entry} />)}</div>
    <EvaluationWorkspace changeSet={changeSet} branchId={branchId} onDirtyChange={onDirtyChange} onBeforeDiscard={onBeforeDiscard} />
    <section className="impact-review"><h4>영향 확인</h4>{changeSet.impact.reviewSet.map((target) => <label key={target.key}><input type="checkbox" disabled={busy} checked={reviewed.includes(target.key)} onChange={() => setReviewed((current) => current.includes(target.key) ? current.filter((key) => key !== target.key) : [...current, target.key])} /><span><strong>{target.title}</strong><small>{target.changed ? "변경됨" : "변경되지 않은 영향 대상 · 필수 확인"} · {target.reasons.join(" · ")}</small></span></label>)}</section>
    {changeSet.impact.warnings.map((warning) => <p className="mechanical-note" key={warning}>{warning}</p>)}
    {changeSet.issues.map((issue) => <p className="blocked-reason" key={`${issue.code}:${issue.keys.join(",")}`}><AlertTriangle /> {issue.message}</p>)}
    {changeSet.blockedReasons.map((reason) => <p className="blocked-reason" key={reason}><AlertTriangle /> {reason}</p>)}
    {error ? <p className="dialog-error" role="alert">{error}</p> : null}
    {canSelectBundles && !allSelected ? <p className="mechanical-note">선택한 묶음으로 새 제안을 만든 뒤 다시 검토해야 합니다. 원래 전체안은 채택되지 않습니다.</p> : null}
    <footer>
      {canSelectBundles && !allSelected ? <button className="button quiet" type="button" disabled={busy || selectedChanges.length === 0 || changeSet.status !== "pending"} onClick={() => void onDerive(selectedChanges)}>선택 묶음으로 새 제안</button> : null}
      <button className="button quiet" type="button" disabled={busy || !["pending", "stale_candidate"].includes(changeSet.status)} onClick={() => void onReject()}><X /> 거절</button>
      <button className="button primary" type="button" disabled={busy || blocked || !allSelected || changeSet.status !== "pending"} onClick={() => void onCommit(reviewed)}><Check /> 검토 승인 후 채택</button>
    </footer>
  </section>
}

function EntryDiff({ entry }: Readonly<{ entry: ChangeEntry }>) {
  const text = (value: ChangeEntry["before"], empty: string): string => value === null ? empty : typeof value === "object" && "text" in value ? value.text : typeof value === "object" && "description" in value ? value.description : JSON.stringify(value, null, 2)
  const metadata = (value: ChangeEntry["before"]) => value === null || Array.isArray(value) ? null : Object.fromEntries(Object.entries(value).filter(([key]) => key !== "text" && key !== "description"))
  return <article className="artifact-diff"><header><span>{entry.kind}</span><strong>{entry.title}</strong></header><div className="comparison-grid"><section><h4>이전</h4><pre>{text(entry.before, "기존 산출물 없음")}</pre></section><ChevronRight /><section><h4>제안</h4><pre>{text(entry.after, "삭제 제안")}</pre></section></div>{entry.kind === "scene" || entry.kind === "plan" ? <details><summary>설정·보호 조건 비교</summary><pre>{JSON.stringify({ before: metadata(entry.before), after: metadata(entry.after) }, null, 2)}</pre></details> : null}</article>
}

function EmptyReview() { return <div className="empty-review"><ShieldCheck /><strong>검토할 V2 제안이 없습니다</strong><p>수동 변경이나 범위를 지정한 AI 수정 제안을 만드세요.</p></div> }

function LegacyCandidates(props: Readonly<{ candidates: readonly Candidate[]; busy: boolean; onScene: (id: string) => void; onPromote: (candidate: Candidate) => Promise<void>; onReject: (candidate: Candidate) => Promise<void> }>) {
  const pending = props.candidates.filter((candidate) => candidate.status === "pending")
  if (pending.length === 0) return null
  return <section className="legacy-proposals"><header><div><p className="overline">LEGACY V1</p><h3>이전 형식 편집안</h3></div><p>이 목록에서는 직접 채택할 수 없습니다. V2로 승격한 뒤 영향 검토를 다시 수행하세요.</p></header>{pending.map((candidate) => <article key={candidate.id}><div><strong>{candidate.reason}</strong><small>{candidate.sceneId}</small></div><button className="button quiet" type="button" disabled={props.busy} onClick={() => props.onScene(candidate.sceneId)}>원고 보기</button><button className="button quiet" type="button" disabled={props.busy} onClick={() => void props.onReject(candidate)}>이전안 거절</button><button className="button primary" type="button" disabled={props.busy} onClick={() => void props.onPromote(candidate)}>V2로 승격</button></article>)}</section>
}

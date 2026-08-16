import { usePlayPageContext } from './PlayPageContext';
import AddPagesFromPromptModal from '../../components/AddPagesFromPromptModal';
import { TtsDialog } from './TtsDialog';
import { ImageStyleDialog } from './ImageStyleDialog';
import { RegenAllDialog } from './RegenAllDialog';
import { ShareDialog } from './ShareDialog';
import { AccessControlDialog } from './AccessControlDialog';
import { GenerationFailedDialog } from './GenerationFailedDialog';
import { PageTypeDialog, pageTypeChoiceOf } from './PageTypeDialog';
import { AddOverlayDialog } from './AddOverlayDialog';
import { FusionFailedDialog } from './FusionFailedDialog';
import { ScriptPatchDialog } from './ScriptPatchDialog';
import { ReactSlideInspectorPanel } from './ReactSlideInspectorPanel';
import { useI18n } from '../../i18n';

export function PlayPageDialogs() {
  const { t } = useI18n();
  const {
    isReadOnlyProcessing,
    // TTS
    ttsDialogOpen, setTtsDialogOpen, ttsProvider, availableTtsVoices,
    ttsVoice, setTtsVoice, ttsSpeaker1Voice, setTtsSpeaker1Voice,
    ttsSpeaker2Voice, setTtsSpeaker2Voice, hostMode, setHostMode, ttsSpeed, setTtsSpeed,
    scriptMaxCharsPerPage, setScriptMaxCharsPerPage, ttsMsg, ttsBusy,
    handleSaveTtsSettings,
    // ImageStyle
    imageStyleDialogOpen, setImageStyleDialogOpen, imageStyleTemplates,
    selectedImageStyleTemplateKey, setSelectedImageStyleTemplateKey,
    applyImageStyleTemplate, deckImageStylePrompt, setDeckImageStylePrompt,
    handleSaveImageStyle,
    // RegenAll
    regenAllDialogOpen, setRegenAllDialogOpen, deckPages,
    regenSelectedPages, regenOptions, setRegenOptions,
    regenAllPrompt, setRegenAllPrompt, regenScriptPrompt, setRegenScriptPrompt,
    regenScriptMaxCharsPerPage, setRegenScriptMaxCharsPerPage,
    regenJob, setRegenJob, regenAllMsg, setRegenAllMsg,
    regenAllBusy, regenJobRunning, regenAnySelected,
    handleConfirmRegenerate,
    // Share
    shareDialogOpen, setShareDialogOpen, shareUrl, shareExpiresAt,
    shareExpiresDays, setShareExpiresDays,
    setShareMessage, setShareError,
    accessDialogOpen, setAccessDialogOpen,
    // AddPages
    showAddPagesModal, setShowAddPagesModal, pdfId, currentPage, totalPages,
    reloadDetail, setCurrentIdx,
    detail, setDetail,
    pageTypeDialogOpen, setPageTypeDialogOpen,
    slideBusy, slideError, setSlideError, handleChangeCurrentPageType,
    fusionFailure, setFusionFailure,
    addOverlayOpen, setAddOverlayOpen, handleAddOverlay, reactBusy, reactError,
    tutorScriptProposal, tutorProposalBusy, applyTutorScriptProposal, dismissTutorScriptProposal,
  } = usePlayPageContext();

  return (
    <>
      <GenerationFailedDialog />
      <ReactSlideInspectorPanel />

      {pageTypeDialogOpen && currentPage ? (
        <PageTypeDialog
          pageNumber={currentPage.page_number}
          current={pageTypeChoiceOf(currentPage.render_type)}
          busy={slideBusy}
          error={slideError}
          onClose={() => {
            setSlideError(null);
            setPageTypeDialogOpen(false);
          }}
          onApply={(choice) => {
            void handleChangeCurrentPageType(choice).then((ok) => {
              if (ok) setPageTypeDialogOpen(false);
            });
          }}
        />
      ) : null}

      {/* The fusion bake failed, so the page is still a React slide and the user picks what next. */}
      {fusionFailure ? (
        <FusionFailedDialog
          message={fusionFailure.message}
          busy={slideBusy}
          onRetry={() => {
            const { choice } = fusionFailure;
            setFusionFailure(null);
            void handleChangeCurrentPageType(choice).then((ok) => {
              if (ok) setPageTypeDialogOpen(false);
            });
          }}
          onForce={() => {
            const { choice } = fusionFailure;
            setFusionFailure(null);
            void handleChangeCurrentPageType(choice, { force: true }).then((ok) => {
              if (ok) setPageTypeDialogOpen(false);
            });
          }}
          onClose={() => setFusionFailure(null)}
        />
      ) : null}

      {addOverlayOpen && currentPage && pdfId ? (
        <AddOverlayDialog
          pdfId={pdfId}
          pageNumber={currentPage.page_number}
          busy={reactBusy}
          error={reactError}
          onClose={() => setAddOverlayOpen(false)}
          onSubmit={(input) => {
            void handleAddOverlay(input).then((ok) => {
              if (ok) setAddOverlayOpen(false);
            });
          }}
        />
      ) : null}

      {tutorScriptProposal ? (
        <ScriptPatchDialog
          page={tutorScriptProposal.page}
          instruction={tutorScriptProposal.instruction}
          original={tutorScriptProposal.original}
          proposed={tutorScriptProposal.proposed}
          busy={tutorProposalBusy}
          onApply={applyTutorScriptProposal}
          onClose={dismissTutorScriptProposal}
        />
      ) : null}

      {ttsDialogOpen ? (
        <TtsDialog
          ttsProvider={ttsProvider}
          availableTtsVoices={availableTtsVoices}
          ttsVoice={ttsVoice}
          onTtsVoiceChange={setTtsVoice}
          ttsSpeaker1Voice={ttsSpeaker1Voice}
          onTtsSpeaker1VoiceChange={setTtsSpeaker1Voice}
          ttsSpeaker2Voice={ttsSpeaker2Voice}
          onTtsSpeaker2VoiceChange={setTtsSpeaker2Voice}
          globalSpeaker1Voice={detail?.global_tts_speaker1_voice ?? null}
          globalSpeaker2Voice={detail?.global_tts_speaker2_voice ?? null}
          hostMode={hostMode}
          onHostModeChange={setHostMode}
          ttsSpeed={ttsSpeed}
          onTtsSpeedChange={setTtsSpeed}
          scriptMaxCharsPerPage={scriptMaxCharsPerPage}
          onScriptMaxCharsPerPageChange={setScriptMaxCharsPerPage}
          ttsMsg={ttsMsg}
          ttsBusy={ttsBusy}
          isReadOnlyProcessing={isReadOnlyProcessing}
          onClose={() => setTtsDialogOpen(false)}
          onSave={() => void handleSaveTtsSettings()}
        />
      ) : null}

      {imageStyleDialogOpen ? (
        <ImageStyleDialog
          imageStyleTemplates={imageStyleTemplates}
          selectedImageStyleTemplateKey={selectedImageStyleTemplateKey}
          onSelectedImageStyleTemplateKeyChange={setSelectedImageStyleTemplateKey}
          onApplyTemplate={applyImageStyleTemplate}
          deckImageStylePrompt={deckImageStylePrompt}
          onDeckImageStylePromptChange={setDeckImageStylePrompt}
          isReadOnlyProcessing={isReadOnlyProcessing}
          onClose={() => setImageStyleDialogOpen(false)}
          onSave={handleSaveImageStyle}
        />
      ) : null}

      {regenAllDialogOpen ? (
        <RegenAllDialog
          deckPagesCount={deckPages.length}
          regenSelectedPages={regenSelectedPages}
          regenOptions={regenOptions}
          onRegenOptionsChange={setRegenOptions}
          regenAllPrompt={regenAllPrompt}
          onRegenAllPromptChange={setRegenAllPrompt}
          regenScriptPrompt={regenScriptPrompt}
          onRegenScriptPromptChange={setRegenScriptPrompt}
          regenScriptMaxCharsPerPage={regenScriptMaxCharsPerPage}
          onRegenScriptMaxCharsPerPageChange={setRegenScriptMaxCharsPerPage}
          hostMode={hostMode}
          onHostModeChange={setHostMode}
          regenJob={regenJob}
          regenAllMsg={regenAllMsg}
          regenAllBusy={regenAllBusy}
          regenJobRunning={regenJobRunning}
          regenAnySelected={regenAnySelected}
          isReadOnlyProcessing={isReadOnlyProcessing}
          onClose={() => {
            setRegenAllDialogOpen(false);
            if (!regenJobRunning) {
              setRegenJob(null);
              setRegenAllMsg(null);
            }
          }}
          onConfirm={() => void handleConfirmRegenerate()}
        />
      ) : null}

      {shareDialogOpen ? (
        <ShareDialog
          shareUrl={shareUrl}
          expiresAt={shareExpiresAt}
          selectedExpiresDays={shareExpiresDays}
          onExpiresDaysChange={setShareExpiresDays}
          onCopySuccess={() => {
            setShareMessage(t('play.shareDialog.copySuccessMessage'));
            setShareError(null);
          }}
          onCopyError={() => setShareError(t('play.shareDialog.copyErrorMessage'))}
          onClose={() => setShareDialogOpen(false)}
        />
      ) : null}

      {accessDialogOpen && pdfId && detail?.is_owner ? (
        <AccessControlDialog
          pdfId={pdfId}
          visibility={detail?.visibility}
          onClose={() => setAccessDialogOpen(false)}
          onVisibilityChange={(visibility) =>
            setDetail((prev) => (prev ? { ...prev, visibility } : prev))
          }
        />
      ) : null}

      {showAddPagesModal && pdfId ? (
        <AddPagesFromPromptModal
          pdfId={pdfId}
          insertAfterPage={currentPage?.page_number ?? totalPages}
          onClose={() => setShowAddPagesModal(false)}
          onDone={async (totalPagesAfter) => {
            setShowAddPagesModal(false);
            await reloadDetail();
            setCurrentIdx(totalPagesAfter - 1);
          }}
        />
      ) : null}
    </>
  );
}

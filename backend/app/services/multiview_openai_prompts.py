from .multiview_workflows import VIEW_ORDER

# Parallel to multiview_edit_prompts.py, but for the OpenAI initial-generation
# and blind-reroll path rather than the instruction-driven edit path. These
# prompts carry no user instruction; they only need to state the target
# camera angle, since IMAGE_GENERATION_INSTRUCTIONS in openai_client.py
# already covers general framing/background rules at the system level.
OPENAI_VIEW_PROMPTS: dict[str, str] = {
    "front": (
        "Using the attached reference image, generate a front view of the same "
        "subject: eye-level shot, medium shot, straight-on camera angle. Keep the "
        "subject's identity, proportions, clothing, accessories, colors, and "
        "background consistent with the reference; only change the camera "
        "viewpoint to face the subject directly from the front."
    ),
    "left": (
        "Using the attached reference image, generate a left side view of the "
        "same subject: eye-level shot, medium shot, camera rotated 90 degrees to "
        "the subject's left. Keep the subject's identity, proportions, clothing, "
        "accessories, colors, and background consistent with the reference; only "
        "change the camera viewpoint."
    ),
    "back": (
        "Using the attached reference image, generate a back view of the same "
        "subject: eye-level shot, medium shot, camera rotated 180 degrees to face "
        "the subject's back. Keep the subject's identity, proportions, clothing, "
        "accessories, colors, and background consistent with the reference; only "
        "change the camera viewpoint."
    ),
}

assert set(OPENAI_VIEW_PROMPTS) == set(VIEW_ORDER)

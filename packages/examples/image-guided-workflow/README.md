# Retake Guided Image Workflow

This narrow Foundation V1 validation Package contributes exactly one Image
Skill, one Workflow, and one bounded AgentPreset. It depends on the public
`image.guided_edit` Capability from Retake Image Studio and does not import or
bundle Image Studio implementation code.

The Workflow accepts a source Image, an inline edit instruction, and an
optional guidance Image such as a reference or Selection Mask. It never runs
automatically and requires human approval of the accepted result.

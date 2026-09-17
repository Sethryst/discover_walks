from huggingface_hub import HfApi

HfApi().upload_folder(
    repo_id="sethryst/osm-us-2026-09-07",
    folder_path=r"C:\Users\igmro\OneDrive\Documents\gremlin_lab\.gremlin-osm\national-pedestrian-routing\work",
    repo_type="dataset",
    path_in_repo=None,
    commit_message="Complete routing substrate upload",
)

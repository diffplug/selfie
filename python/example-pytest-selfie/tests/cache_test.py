import random
import os
import requests

from selfie_lib import cache_selfie, cache_selfie_binary, cache_selfie_json

from openai import OpenAI


def test_cache_selfie():
    cache_selfie(lambda: str(random.random())).to_be("0.06699295946441819")


def test_gen_ai():
    # Initialize OpenAI API client
    openai = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

    # Fetch the chat response with caching
    chat = cache_selfie_json(
        lambda: openai.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "user",
                    "content": "Expressive but brief language describing a robot creating a self portrait.",
                }
            ],
        ).to_dict()
    ).to_be("""{
    "id": "chatcmpl-Af1Nf34netAfGW7ZIQArEHavfuYtg",
    "choices": [
        {
            "finish_reason": "stop",
            "index": 0,
            "logprobs": null,
            "message": {
                "content": "A sleek robot, its mechanical fingers dancing with precision, deftly wields a brush against the canvas. Whirs and clicks echo softly as vibrant strokes emerge, each infused with an unexpected soulfulness. Metal meets art as synthetic imagination captures its own intricate reflection\\u2014a symphony of circuitry bathed in delicate hues.",
                "refusal": null,
                "role": "assistant"
            }
        }
    ],
    "created": 1734340119,
    "model": "gpt-4o-2024-08-06",
    "object": "chat.completion",
    "system_fingerprint": "fp_9faba9f038",
    "usage": {
        "completion_tokens": 62,
        "prompt_tokens": 20,
        "total_tokens": 82,
        "completion_tokens_details": {
            "accepted_prediction_tokens": 0,
            "audio_tokens": 0,
            "reasoning_tokens": 0,
            "rejected_prediction_tokens": 0
        },
        "prompt_tokens_details": {
            "audio_tokens": 0,
            "cached_tokens": 0
        }
    }
}""")
    # raise ValueError(f"KEYS={chat.keys()} TYPE={type(chat)}")
    image_url = cache_selfie_json(
        lambda: openai.images.generate(
            model="dall-e-3", prompt=chat["choices"][0]["message"]["content"]
        ).to_dict()
    ).to_be("""{
    "created": 1734340142,
    "data": [
        {
            "revised_prompt": "Visualize a sleek robot adorned in a metallic shell. Its highly precise mechanical digits engage rhythmically with a paintbrush, swirling it flawlessly over a robust canvas. The environment is immersed in resonating mechanical sounds blended with the aura of creativity unfurling. Strikingly vivid strokes of paint materialize from the robot's calculated artistry, each stroke conveying a depth and emotion unanticipated of a mechanical entity. This metallic artist exhibits its self-inspired art by meticulously crafting its own intricate reflection\\u2014an orchestra of electronics bathed in a palette of gentle colors.",
            "url": "https://oaidalleapiprodscus.blob.core.windows.net/private/org-SUepmbCtftBix3RViJYKuYKY/user-KFRqcsnjZPSTulNaxrY5wjL3/img-JVxDCOAuLoIky3ucNNJWo7fG.png?st=2024-12-16T08%3A09%3A02Z&se=2024-12-16T10%3A09%3A02Z&sp=r&sv=2024-08-04&sr=b&rscd=inline&rsct=image/png&skoid=d505667d-d6c1-4a0a-bac7-5c84a87759f8&sktid=a48cca56-e6da-484e-a814-9c849652bcb3&skt=2024-12-16T00%3A47%3A43Z&ske=2024-12-17T00%3A47%3A43Z&sks=b&skv=2024-08-04&sig=nIiMMZBNnqPO2jblJ8pDvWS2AFTOaicAWAD6BDqP9jU%3D"
        }
    ]
}""")

    url = image_url["data"][0]["url"]
    cache_selfie_binary(lambda: requests.get(url).content).to_be_file(
        "self-portrait.png"
    )

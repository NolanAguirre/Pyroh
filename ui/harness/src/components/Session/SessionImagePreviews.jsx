import { ImageAttachmentPreviews } from 'component-library'
import api from '../../api'

const SessionImagePreviews = ({ images, sessionId }) => (
  <ImageAttachmentPreviews items={(Array.isArray(images) ? images : []).map((image) => ({
    ...image,
    key: `${image.sessionId || sessionId}:${image.id}`,
    src: api.sessionImageUrl(sessionId, image),
  }))} />
)

export default SessionImagePreviews

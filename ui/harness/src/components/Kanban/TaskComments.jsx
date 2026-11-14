import { useState } from 'react'
import { Button, FormTextarea, DevScope } from 'component-library'
import KanbanQuery from './KanbanQuery'
import { COMMENTS_QUERY, addComment, addReply } from './api'

const CommentComposer = ({ devId, reply = false, busy, onPost, onCancel, postDevId, cancelDevId }) => {
  const [body, setBody] = useState('')
  return <DevScope id={devId}><form className="comment-composer" onSubmit={async (event) => {
    event.preventDefault()
    if (!busy && body.trim() && await onPost(body.trim())) setBody('')
  }}>
    <label>{reply ? 'Your reply' : 'Add a comment'}
      <DevScope id="g5anvho"><FormTextarea field={{ value: body, onChange: (event) => setBody(event.target.value) }}
        rows={3} maxLength={20000} required disabled={busy} autoFocus={reply}
        placeholder={reply ? 'Write a reply…' : 'Write a comment…'} /></DevScope>
    </label>
    <div className="kanban__comment-actions">
      {onCancel && <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onCancel} devId={cancelDevId}>Cancel reply</Button>}
      <Button type="submit" size="sm" disabled={busy || !body.trim()} devId={postDevId}>{reply ? 'Post reply' : 'Post comment'}</Button>
    </div>
  </form></DevScope>
}

const CommentText = ({ item }) => {
  return <>
  <strong className="kanban__comment-author">{item.userByAuthorId?.name || 'Unknown author'}</strong>
  <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
  <p className="kanban__comment-body">{item.body}</p>
</>
}

const CommentList = ({ devId, user, cardId, busy, onChange, allCardComments }) => {
  const comments = allCardComments.nodes
  const [replyTo, setReplyTo] = useState(null)
  const post = async (body, commentId = null) => {
    const result = await onChange(() => commentId
      ? addReply(commentId, body, user.id)
      : addComment(cardId, body, user.id))
    if (!result) return false
    if (commentId) setReplyTo(null)
    return true
  }

  return <DevScope id={devId}>
    <section className="kanban__task-comments" aria-label="Task comments" aria-busy={busy}>
      <h3>Comments</h3>
      <>
        {comments.length === 0 && <p className="kanban__comments-empty">No comments yet.</p>}
        <ol className="kanban__comment-list">
          {comments.map((comment) => <li key={comment.id}>
            <DevScope id="psyifuu" state={{ comment: comment.id }}>
              <article className="kanban__task-comment">
                <CommentText item={comment} />
                <Button type="button" size="sm" variant="ghost" disabled={busy} aria-expanded={replyTo === comment.id} onClick={() => setReplyTo(comment.id)} devId="asme6ii">Reply</Button>
                {comment.commentRepliesByCommentId.nodes.length > 0 && <ol className="kanban__comment-replies" aria-label="Replies">
                  {comment.commentRepliesByCommentId.nodes.map((reply) => <DevScope key={reply.id} id="6a3ddyx" state={{ reply: reply.id }}><li><CommentText item={reply} /></li></DevScope>)}
                </ol>}
                {replyTo === comment.id && <CommentComposer devId="df7puyi" key={comment.id} reply busy={busy} onPost={(body) => post(body, comment.id)} onCancel={() => setReplyTo(null)} postDevId="93vzk32" cancelDevId="jw1w1wh" />}
              </article>
            </DevScope>
          </li>)}
        </ol>
        <CommentComposer devId="ckplxvc" busy={busy} onPost={post} postDevId="60hzulj" />
      </>
    </section>
  </DevScope>
}

const TaskComments = (props) => {
  return <KanbanQuery devId="h24omc3" query={COMMENTS_QUERY} variables={{ cardId: props.cardId }}><CommentList {...props} /></KanbanQuery>
}

export default TaskComments
